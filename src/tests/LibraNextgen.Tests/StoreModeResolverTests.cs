using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;
using Xunit;

namespace LibraNextgen.Tests;

public class StoreModeResolverTests
{
    private sealed class FakeProbe : IMongoReachabilityProbe
    {
        private readonly bool _result;
        public int Calls { get; private set; }

        public FakeProbe(bool result) => _result = result;

        public Task<bool> IsReachableAsync(CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(_result);
        }
    }

    private static UserConfig Config(string mode, bool fallback = true) => new()
    {
        Storage = new UserStorageConfig { Mode = mode, Fallback = fallback },
    };

    private static Task<StoreResolution> Resolve(UserConfig? config, FakeProbe probe)
        => new StoreModeResolver(probe).ResolveAsync(config);

    [Fact]
    public async Task NoConfig_DefaultsToMongo_LikeCloud_NoProbeNoExit()
    {
        var probe = new FakeProbe(false);
        var resolution = await Resolve(null, probe);

        Assert.Equal(StoreKind.Mongo, resolution.Requested);
        Assert.Equal(StoreKind.Mongo, resolution.Effective);
        Assert.False(resolution.ExitRequested);
        Assert.Equal(0, probe.Calls); // cloud boot must not probe/exit — today's behavior stays
    }

    [Fact]
    public async Task ConfigSqlite_ResolvesSqlite_WithoutProbing()
    {
        var probe = new FakeProbe(false);
        var resolution = await Resolve(Config("sqlite"), probe);

        Assert.Equal(StoreKind.Sqlite, resolution.Requested);
        Assert.Equal(StoreKind.Sqlite, resolution.Effective);
        Assert.False(resolution.ExitRequested);
        Assert.Equal(0, probe.Calls);
    }

    [Fact]
    public async Task ConfigMongo_Reachable_ResolvesMongo()
    {
        var probe = new FakeProbe(true);
        var resolution = await Resolve(Config("mongo"), probe);

        Assert.Equal(StoreKind.Mongo, resolution.Effective);
        Assert.Null(resolution.FallbackReason);
        Assert.False(resolution.ExitRequested);
        Assert.Equal(1, probe.Calls);
    }

    [Fact]
    public async Task ConfigMongo_Unreachable_WithFallback_FallsBackToSqlite()
    {
        var probe = new FakeProbe(false);
        var resolution = await Resolve(Config("mongo", fallback: true), probe);

        Assert.Equal(StoreKind.Mongo, resolution.Requested);
        Assert.Equal(StoreKind.Sqlite, resolution.Effective);
        Assert.Equal("mongo_unreachable", resolution.FallbackReason);
        Assert.False(resolution.ExitRequested);
    }

    [Fact]
    public async Task ConfigMongo_Unreachable_WithoutFallback_RequestsExit()
    {
        var probe = new FakeProbe(false);
        var resolution = await Resolve(Config("mongo", fallback: false), probe);

        Assert.Equal(StoreKind.Mongo, resolution.Effective);
        Assert.True(resolution.ExitRequested);
        Assert.NotNull(resolution.Error);
    }
}
