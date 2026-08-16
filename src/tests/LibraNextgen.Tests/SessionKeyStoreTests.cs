using LibraNextgen.Service.Services;
using Xunit;

namespace LibraNextgen.Tests;

public class SessionKeyStoreTests
{
    [Fact]
    public void SetThenGet_ReturnsKey()
    {
        var store = new SessionKeyStore();
        var key = new byte[] { 1, 2, 3, 4 };
        store.Set("agent-1", key);

        Assert.True(store.TryGet("agent-1", out var found));
        Assert.Equal(key, found);
    }

    [Fact]
    public void Get_MissingAgent_ReturnsFalse()
    {
        var store = new SessionKeyStore();
        Assert.False(store.TryGet("missing", out var found));
        Assert.Null(found);
    }

    [Fact]
    public void Set_OverwritesExistingKey()
    {
        var store = new SessionKeyStore();
        store.Set("agent-1", new byte[] { 1 });
        store.Set("agent-1", new byte[] { 9, 9 });

        Assert.True(store.TryGet("agent-1", out var found));
        Assert.Equal(new byte[] { 9, 9 }, found);
    }

    [Fact]
    public void Remove_ClearsKey()
    {
        var store = new SessionKeyStore();
        store.Set("agent-1", new byte[] { 1 });
        store.Remove("agent-1");

        Assert.False(store.TryGet("agent-1", out _));
    }
}
