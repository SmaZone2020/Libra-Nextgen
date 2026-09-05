using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Services.Mesh;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>Mesh registration CRUD + secret protection against the SQLite store.</summary>
public class MeshNodeServiceTests : IDisposable
{
    private readonly SqliteDbContext _db;
    private readonly IStore<MeshNode> _store;
    private readonly MeshNodeService _service;
    private readonly string _path;

    public MeshNodeServiceTests()
    {
        _path = Path.Combine(Path.GetTempPath(), "libra-tests", $"{Guid.NewGuid():N}.db");
        _db = new SqliteDbContext(_path);
        _store = new SqliteStore<MeshNode>(_db, "mesh_nodes_test");
        _service = new MeshNodeService(_store);
    }

    public void Dispose()
    {
        _db.Dispose();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_path + suffix); } catch { /* best effort */ }
        }
    }

    private static MeshAuthSpec Pw(string username = "admin", string password = "s3cret!") =>
        new(MeshAuthKind.Password, username, password);

    [Fact]
    public async Task Create_RoundTripsAndCiphersSecret()
    {
        var node = await _service.CreateAsync("Node A", "http://10.0.0.5:5270", Pw(), "u1", "alice");

        Assert.False(string.IsNullOrEmpty(node.Id));
        Assert.Equal("Node A", node.Name);
        Assert.Equal("http://10.0.0.5:5270", node.Origin);
        Assert.NotEqual("s3cret!", node.SecretCipher);
        Assert.Equal(MeshAuthKind.Password, node.AuthKind);

        var loaded = await _service.GetAsync(node.Id);
        Assert.NotNull(loaded);
        Assert.Equal("admin", loaded!.Username);
        Assert.Equal("s3cret!", _service.GetSecret(loaded));
        Assert.Equal("u1", loaded.CreatedByUserId);
    }

    [Fact]
    public async Task Create_AccessKeyNode_StoresNoUsername()
    {
        var node = await _service.CreateAsync("Node B", "https://c2.example.com", new MeshAuthSpec(MeshAuthKind.AccessKey, null, "lnk_abc"), "u1", "alice");

        Assert.Equal(MeshAuthKind.AccessKey, node.AuthKind);
        Assert.Equal("", node.Username);
        Assert.Equal("lnk_abc", _service.GetSecret(node));
    }

    [Fact]
    public async Task Create_DuplicateName_Throws()
    {
        await _service.CreateAsync("Node A", "http://a:5270", Pw(), "u1", "alice");
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => _service.CreateAsync("Node A", "http://b:5270", Pw(), "u1", "alice"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("toolongname-toolongname-toolongname-toolongname-toolongname-toolongname-toolongname")]
    public void Create_InvalidName_Throws(string name)
    {
        Assert.Throws<ArgumentException>(() => _service.CreateAsync(name, "http://a:5270", Pw(), "u1", "alice").GetAwaiter().GetResult());
    }

    [Theory]
    [InlineData("not a url")]
    [InlineData("ftp://a:5270")]
    [InlineData("http://a:5270/with/path")]
    [InlineData("http://user:pw@a:5270")]
    public void Create_InvalidOrigin_Throws(string origin)
    {
        Assert.Throws<ArgumentException>(() => _service.CreateAsync("N", origin, Pw(), "u1", "alice").GetAwaiter().GetResult());
    }

    [Fact]
    public async Task Create_PasswordAuthRequiresUsername()
    {
        await Assert.ThrowsAsync<ArgumentException>(
            () => _service.CreateAsync("N", "http://a:5270", new MeshAuthSpec(MeshAuthKind.Password, "  ", "pw"), "u1", "alice"));
    }

    [Fact]
    public async Task Create_AccessKeyAuthRequiresKey()
    {
        await Assert.ThrowsAsync<ArgumentException>(
            () => _service.CreateAsync("N", "http://a:5270", new MeshAuthSpec(MeshAuthKind.AccessKey, null, " "), "u1", "alice"));
    }

    [Fact]
    public async Task Update_RenameAndSwitchAuth()
    {
        var node = await _service.CreateAsync("Node A", "http://a:5270", Pw("admin", "pw1"), "u1", "alice");

        var renamed = await _service.UpdateAsync(node.Id, new MeshNodeUpdate("Node A-2", null, null));
        Assert.NotNull(renamed);
        Assert.Equal("Node A-2", renamed!.Name);
        Assert.Equal("pw1", _service.GetSecret(renamed));

        var switched = await _service.UpdateAsync(node.Id,
            new MeshNodeUpdate(null, "https://b:5270", new MeshAuthSpec(MeshAuthKind.AccessKey, null, "lnk_x")));
        Assert.NotNull(switched);
        Assert.Equal("https://b:5270", switched!.Origin);
        Assert.Equal(MeshAuthKind.AccessKey, switched!.AuthKind);
        Assert.Equal("lnk_x", _service.GetSecret(switched));

        // Identity survives updates.
        Assert.Equal(node.Id, switched!.Id);
        Assert.Equal(node.CreatedAt, switched.CreatedAt);
    }

    [Fact]
    public async Task Update_UnknownId_ReturnsNull()
    {
        Assert.Null(await _service.UpdateAsync("missing", new MeshNodeUpdate("X", null, null)));
    }

    [Fact]
    public async Task Delete_RemovesNode()
    {
        var node = await _service.CreateAsync("Node A", "http://a:5270", Pw(), "u1", "alice");
        Assert.True(await _service.DeleteAsync(node.Id));
        Assert.False(await _service.DeleteAsync(node.Id));
        Assert.Null(await _service.GetAsync(node.Id));
    }

    [Fact]
    public async Task RecordConnectResult_UpdatesLastErrorAndConnectedAt()
    {
        var node = await _service.CreateAsync("Node A", "http://a:5270", Pw(), "u1", "alice");

        await _service.RecordConnectResultAsync(node.Id, false, "boom");
        var failed = await _service.GetAsync(node.Id);
        Assert.Equal("boom", failed!.LastError);
        Assert.Null(failed.LastConnectedAt);

        await _service.RecordConnectResultAsync(node.Id, true, null);
        var ok = await _service.GetAsync(node.Id);
        Assert.Null(ok!.LastError);
        Assert.NotNull(ok.LastConnectedAt);
    }
}

public class MeshSecretsTests
{
    [Fact]
    public void ProtectUnprotect_RoundTrips()
    {
        foreach (var secret in new[] { "s3cret-password", "lnk_Aa1234", "空格 密 码 &符号" })
        {
            var cipher = MeshSecrets.Protect(secret);
            Assert.NotEqual(secret, cipher);
            Assert.Equal(secret, MeshSecrets.Unprotect(cipher));
        }
    }
}
