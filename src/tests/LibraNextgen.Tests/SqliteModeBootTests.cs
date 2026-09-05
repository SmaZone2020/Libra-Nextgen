using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Services.Auth;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// Boots the whole Program in desktop SQLite mode (libra.conf.json with
/// mode=sqlite under a user-data-dir) and proves the store wiring end to end:
/// resolution picks SQLite, services run against the local document store,
/// and the initial-setup -> login auth flow works without MongoDB.
/// </summary>
public class SqliteModeBootTests : IDisposable
{
    private readonly string _userDataDir;

    public SqliteModeBootTests()
    {
        _userDataDir = Path.Combine(Path.GetTempPath(), "libra-boot-tests", $"{Guid.NewGuid():N}");
        Directory.CreateDirectory(_userDataDir);
        File.WriteAllText(
            Path.Combine(_userDataDir, "libra.conf.json"),
            """{"schemaVersion":1,"storage":{"mode":"sqlite","fallback":true}}""");
    }

    public void Dispose()
    {
        try { Directory.Delete(_userDataDir, true); } catch { /* best effort */ }
    }

    [Fact]
    public async Task SqliteMode_Boots_AuthFlowWorks_StoreIsSqlite()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("user-data-dir", _userDataDir);
        });
        using var scope = factory.Services.CreateScope();
        var services = scope.ServiceProvider;

        // SQLite store must be the registered engine for the users collection.
        var sqliteDb = services.GetRequiredService<SqliteDbContext>();
        Assert.NotNull(sqliteDb);
        Assert.True(File.Exists(sqliteDb.DbPath), $"expected sqlite db at {sqliteDb.DbPath}");

        // Initial setup -> login round trip against SQLite.
        var auth = services.GetRequiredService<AuthService>();
        Assert.True(await auth.NeedsSetupAsync());
        var setup = await auth.SetupAsync("admin", "password123", "127.0.0.1");
        Assert.Equal(UserRole.Admin, setup.Role);
        Assert.False(await auth.NeedsSetupAsync());

        var login = await auth.LoginAsync(new LoginRequest { Username = "admin", Password = "password123" }, "127.0.0.1");
        Assert.NotNull(login);
        Assert.Equal("admin", login!.Username);

        // Duplicate setup is rejected provider-neutrally.
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => auth.SetupAsync("other", "password456", "127.0.0.1"));

        // Core-domain store CRUD through the migrated IStore wiring.
        var agents = services.GetRequiredService<IStore<Agent>>();
        await agents.InsertAsync(new Agent { Id = "a1", Hostname = "host-1", Status = AgentStatus.Offline });
        var reloaded = await agents.GetByIdAsync("a1");
        Assert.NotNull(reloaded);
        Assert.Equal("host-1", reloaded!.Hostname);

        // The migrated AgentService observes the same data.
        var agentService = services.GetRequiredService<LibraNextgen.Service.Services.Agents.AgentService>();
        var list = await agentService.GetAllAsync();
        Assert.Single(list);
        Assert.Equal("a1", list[0].Id);
    }
}
