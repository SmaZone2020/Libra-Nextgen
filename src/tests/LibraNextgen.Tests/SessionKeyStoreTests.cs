using Microsoft.Extensions.Options;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Models;
using LibraNextgen.Service.Services.Agents;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// </summary>
public class SessionKeyStoreTests
{
    private static SessionKeyStore NewStore()
    {
        var settings = new MongoSettings
        {
            ConnectionString = "mongodb://localhost:27017",
            DatabaseName = $"libra_test_{Guid.NewGuid():N}",
            ConnectTimeoutSeconds = 1,
        };
        var context = new MongoDbContext(Options.Create(settings));
        return new SessionKeyStore(
            new Repository<SessionKey>(context, "session_keys"),
            new Repository<SessionTokenDoc>(context, "session_tokens"));
    }

    [Fact]
    public void SetThenGet_ReturnsKey()
    {
        var store = NewStore();
        var key = new byte[] { 1, 2, 3, 4 };
        store.Set("agent-1", key);

        Assert.True(store.TryGet("agent-1", out var found));
        Assert.Equal(key, found);
    }

    [Fact]
    public void Get_MissingAgent_ReturnsFalse()
    {
        var store = NewStore();
        Assert.False(store.TryGet("missing", out var found));
        Assert.Null(found);
    }

    [Fact]
    public void Set_OverwritesExistingKey()
    {
        var store = NewStore();
        store.Set("agent-1", new byte[] { 1 });
        store.Set("agent-1", new byte[] { 9, 9 });

        Assert.True(store.TryGet("agent-1", out var found));
        Assert.Equal(new byte[] { 9, 9 }, found);
    }

    [Fact]
    public void Remove_ClearsKey()
    {
        var store = NewStore();
        store.Set("agent-1", new byte[] { 1 });
        store.Remove("agent-1");

        Assert.False(store.TryGet("agent-1", out _));
    }
}
