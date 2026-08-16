using LibraNextgen.Common.Models;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using LibraNextgen.Service.Configuration;

namespace LibraNextgen.Service.Data;

/// <summary>
/// Creates the MongoDB indexes the app relies on. Idempotent — called once at
/// startup. Without these, every registration/heartbeat performs a full
/// collection scan and traffic/task collections grow unbounded.
/// </summary>
public class MongoIndexBuilder
{
    private readonly MongoDbContext _context;
    private readonly MongoSettings _settings;
    private readonly ILogger<MongoIndexBuilder> _logger;

    public MongoIndexBuilder(
        MongoDbContext context,
        IOptions<MongoSettings> settings,
        ILogger<MongoIndexBuilder> logger)
    {
        _context = context;
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        await CreateAgentsAsync(ct);
        await CreateTasksAsync(ct);
        await CreateTrafficAsync(ct);
        await CreateUsersAsync(ct);
        await CreateAuditLogsAsync(ct);
    }

    private async Task CreateAgentsAsync(CancellationToken ct)
    {
        var col = _context.GetCollection<Agent>("agents");
        var models = new[]
        {
            new CreateIndexModel<Agent>(Builders<Agent>.IndexKeys.Ascending(a => a.Hwid)),
            new CreateIndexModel<Agent>(Builders<Agent>.IndexKeys.Ascending(a => a.Hostname).Ascending(a => a.UserName)),
            new CreateIndexModel<Agent>(Builders<Agent>.IndexKeys.Ascending(a => a.Status).Descending(a => a.LastSeen)),
        };
        await col.Indexes.CreateManyAsync(models, ct);
    }

    private async Task CreateTasksAsync(CancellationToken ct)
    {
        var col = _context.GetCollection<AgentTask>("tasks");
        var models = new[]
        {
            new CreateIndexModel<AgentTask>(Builders<AgentTask>.IndexKeys.Ascending(t => t.AgentId).Ascending(t => t.Status).Ascending(t => t.CreatedAt)),
            new CreateIndexModel<AgentTask>(Builders<AgentTask>.IndexKeys.Ascending(t => t.Status).Descending(t => t.CreatedAt)),
        };
        await col.Indexes.CreateManyAsync(models, ct);
    }

    private async Task CreateTrafficAsync(CancellationToken ct)
    {
        var col = _context.GetCollection<TrafficRecord>("traffic");

        var models = new List<CreateIndexModel<TrafficRecord>>();
        if (_settings.TrafficTtlDays > 0)
        {
            models.Add(new CreateIndexModel<TrafficRecord>(
                Builders<TrafficRecord>.IndexKeys.Ascending(t => t.Timestamp),
                new CreateIndexOptions { ExpireAfter = TimeSpan.FromDays(_settings.TrafficTtlDays) }));
        }
        else
        {
            models.Add(new CreateIndexModel<TrafficRecord>(
                Builders<TrafficRecord>.IndexKeys.Descending(t => t.Timestamp)));
        }

        await col.Indexes.CreateManyAsync(models, ct);
    }

    private async Task CreateUsersAsync(CancellationToken ct)
    {
        var col = _context.GetCollection<User>("users");
        await col.Indexes.CreateOneAsync(
            new CreateIndexModel<User>(
                Builders<User>.IndexKeys.Ascending(u => u.Username),
                new CreateIndexOptions { Unique = true }),
            cancellationToken: ct);
    }

    private async Task CreateAuditLogsAsync(CancellationToken ct)
    {
        var col = _context.GetCollection<AuditLog>("audit_logs");
        await col.Indexes.CreateOneAsync(
            new CreateIndexModel<AuditLog>(Builders<AuditLog>.IndexKeys.Descending(a => a.Timestamp)),
            cancellationToken: ct);
    }
}
