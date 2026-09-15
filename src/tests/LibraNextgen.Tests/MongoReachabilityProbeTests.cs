using System.Net;
using System.Net.Sockets;
using LibraNextgen.Service.Data;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// The probe must ping the database the connection string names: a user-supplied
/// credential is typically scoped to its own database, so pinging <c>admin</c>
/// unconditionally reports a healthy server as unreachable.
/// </summary>
public class MongoReachabilityProbeTests
{
    [Theory]
    [InlineData("mongodb://127.0.0.1:27017/libra_probe_test", "libra_probe_test")]
    [InlineData("mongodb://127.0.0.1:27017/libra_probe_test?authSource=admin", "libra_probe_test")]
    [InlineData("mongodb://user:pw@127.0.0.1:27017/appdb?retryWrites=true", "appdb")]
    [InlineData("mongodb://h1:27017,h2:27017, h3:27017/sharded", "sharded")]
    [InlineData("mongodb+srv://user:pw@cluster.example.com/srvdb", "srvdb")]
    // No database named -> the only thing a driver-level ping can target.
    [InlineData("mongodb://127.0.0.1:27017", "admin")]
    [InlineData("mongodb://127.0.0.1:27017/", "admin")]
    [InlineData("mongodb://user:pw@127.0.0.1:27017/?authSource=admin", "admin")]
    public void ResolveProbeDatabase_UsesConfiguredDatabase_ElseAdmin(string connectionString, string expected)
    {
        Assert.Equal(expected, MongoReachabilityProbe.ResolveProbeDatabase(connectionString));
    }

    [Fact]
    public async Task UnparsableConnectionString_ReturnsFalse_InsteadOfThrowing()
    {
        var probe = new MongoReachabilityProbe("this-is-not-a-mongo-url", TimeSpan.FromMilliseconds(250));

        Assert.False(await probe.IsReachableAsync());
    }

    [Fact]
    public async Task ClosedPort_FailsFast_AndRespectsTheCancellationToken()
    {
        var port = FreeLoopbackPort();
        var probe = new MongoReachabilityProbe($"mongodb://127.0.0.1:{port}/x", TimeSpan.FromMilliseconds(500));

        Assert.False(await probe.IsReachableAsync());

        using var cts = new CancellationTokenSource();
        cts.Cancel();
        Assert.False(await probe.IsReachableAsync(cts.Token));
    }

    private static int FreeLoopbackPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }
}
