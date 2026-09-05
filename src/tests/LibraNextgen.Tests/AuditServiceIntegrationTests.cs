using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Services.Platform;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using Xunit;
using MongoSettings = LibraNextgen.Service.Configuration.MongoSettings;

namespace LibraNextgen.Tests;

/// <summary>
/// Verifies AuditService query semantics against a real MongoDB, proving the
/// provider-neutral predicate forms (case-insensitive search via ToLower +
/// Contains, composed AndAlso/OrElse) translate on the Mongo LINQ provider
/// without throwing ExpressionNotSupportedException. Requires a reachable
/// MongoDB (LIBRA_TEST_MONGO or localhost:27017); unique DB per fixture.
/// </summary>
public class AuditServiceIntegrationTests : IAsyncLifetime
{
    private readonly IMongoClient _mongo;
    private readonly string _url;
    private readonly string _dbName;
    private AuditService? _service;
    private readonly DateTime _base = new(2025, 1, 10, 12, 0, 0, DateTimeKind.Utc);

    public AuditServiceIntegrationTests()
    {
        _url = Environment.GetEnvironmentVariable("LIBRA_TEST_MONGO") ?? "mongodb://localhost:27017";
        _dbName = $"libra_audit_it_{Guid.NewGuid():N}";
        _mongo = new MongoClient(_url);
    }

    public async Task InitializeAsync()
    {
        await _mongo.ListDatabaseNamesAsync(); // fail fast when MongoDB is absent
        var context = new MongoDbContext(Options.Create(new MongoSettings
        {
            ConnectionString = _url,
            DatabaseName = _dbName,
        }));
        var auditLogs = new Repository<AuditLog>(context, "audit_logs");
        _service = new AuditService(auditLogs, new RiskPolicyService(new Repository<RiskPolicy>(context, "risk_policy")));

        await auditLogs.InsertManyAsync(new[]
        {
            new AuditLog { UserName = "Alice", Action = "POST /api/agents/list", IpAddress = "10.0.0.1", Risk = RiskLevel.Normal, Timestamp = _base.AddMinutes(1) },
            new AuditLog { UserName = "bob", Action = "POST /api/beacon/heartbeat", IpAddress = "10.0.0.2", Risk = RiskLevel.Dangerous, Timestamp = _base.AddMinutes(2) },
            new AuditLog { UserName = "Carol", Action = "GET /api/account/me", IpAddress = "10.0.0.3", Risk = RiskLevel.Normal, Timestamp = _base.AddMinutes(3) },
        });
    }

    public async Task DisposeAsync()
    {
        try { await _mongo.DropDatabaseAsync(_dbName); } catch { /* best effort */ }
    }

    [Fact]
    public async Task Search_IsCaseInsensitiveAcrossFields()
    {
        var (logs, total) = await _service!.GetPagedAsync(1, 50, query: "ALICE");
        Assert.Equal(1, total);
        Assert.Equal("Alice", logs[0].UserName);

        // bob is a heartbeat row, which the default filter excludes — pass
        // excludeHeartbeats:false to probe IP-address search.
        (logs, total) = await _service.GetPagedAsync(1, 50, query: "10.0.0.2", excludeHeartbeats: false);
        Assert.Equal(1, total);
        Assert.Equal("bob", logs[0].UserName);

        (_, total) = await _service.GetPagedAsync(1, 50, query: "carol");
        Assert.Equal(1, total);
    }

    [Fact]
    public async Task DefaultExcludesHeartbeats()
    {
        var (_, total) = await _service!.GetPagedAsync(1, 50);
        Assert.Equal(2, total);

        (_, total) = await _service.GetPagedAsync(1, 50, excludeHeartbeats: false);
        Assert.Equal(3, total);
    }

    [Fact]
    public async Task RiskFilter_MatchesStoredRisk()
    {
        // bob (Dangerous) is a heartbeat row — include heartbeats to reach it.
        var (logs, total) = await _service!.GetPagedAsync(1, 50, risk: RiskLevel.Dangerous, excludeHeartbeats: false);
        Assert.Equal(1, total);
        Assert.Equal("bob", logs[0].UserName);
    }

    [Fact]
    public async Task TimeRangeFilter_AppliesFromAndTo()
    {
        // bob(+2min) is excluded by default as a heartbeat; Carol(+3min) remains.
        var (_, total) = await _service!.GetPagedAsync(1, 50, from: _base.AddMinutes(2), to: _base.AddMinutes(3));
        Assert.Equal(1, total);

        (_, total) = await _service!.GetPagedAsync(1, 50, from: _base.AddMinutes(2), to: _base.AddMinutes(3), excludeHeartbeats: false);
        Assert.Equal(2, total);
    }
}
