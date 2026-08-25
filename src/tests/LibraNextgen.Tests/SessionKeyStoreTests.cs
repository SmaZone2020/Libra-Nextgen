using Microsoft.Extensions.Options;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Services;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// SessionKeyStore 内存缓存行为测试。
/// 用独立的测试库名构造 MongoDbContext（Set/Remove 的持久化写入是 fire-and-forget，
/// 失败被吞掉，不影响内存缓存断言；本机有 MongoDB 时则走真实写入）。
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
        return new SessionKeyStore(new MongoDbContext(Options.Create(settings)));
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
