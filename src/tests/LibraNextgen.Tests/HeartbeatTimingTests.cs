using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services.Agents;
using Xunit;

namespace LibraNextgen.Tests;

public class HeartbeatTimingTests
{
    [Fact]
    public void OfflineTimeout_UsesDeclaredIntervalPlusFiveSeconds()
    {
        var agent = new Agent
        {
            HeartbeatInterval = 30,
            HeartbeatIntervalMs = 30_000,
        };

        Assert.Equal(TimeSpan.FromSeconds(35), HeartbeatTiming.GetOfflineTimeout(agent));
    }

    [Fact]
    public void OfflineTimeout_LegacyDocumentFallsBackToSecondsField()
    {
        var agent = new Agent { HeartbeatInterval = 60 };

        Assert.Equal(TimeSpan.FromSeconds(65), HeartbeatTiming.GetOfflineTimeout(agent));
    }

    [Fact]
    public void OfflineTimeout_KeepsSubSecondMilliseconds()
    {
        var agent = new Agent
        {
            HeartbeatInterval = 1,
            HeartbeatIntervalMs = 3_500,
        };

        Assert.Equal(TimeSpan.FromMilliseconds(8_500), HeartbeatTiming.GetOfflineTimeout(agent));
    }

    [Fact]
    public void Register_AgentReportedIntervalWinsOverServerFallback()
    {
        var request = new RegisterRequest { HeartbeatIntervalMs = 7_500 };
        var ms = HeartbeatTiming.ResolveIntervalMs(request, fallbackSeconds: 60);

        Assert.Equal(7_500, ms);
    }

    [Fact]
    public void Register_MissingIntervalUsesServerFallback()
    {
        var request = new RegisterRequest();
        var ms = HeartbeatTiming.ResolveIntervalMs(request, fallbackSeconds: 60);

        Assert.Equal(60_000, ms);
    }
}
