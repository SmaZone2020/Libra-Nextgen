using LibraNextgen.Common.Authorization;
using LibraNextgen.Common.Models;
using Xunit;

namespace LibraNextgen.Tests;

public class RiskClassifierTests
{
    [Theory]
    [InlineData("/api/system/abc/processes", RiskActions.SystemInfo)]
    [InlineData("/api/system/abc/processes/kill", RiskActions.SystemProcessKill)]
    [InlineData("/api/screen/stream/abc", RiskActions.ScreenMonitor)]
    [InlineData("/api/files/abc/list", RiskActions.FileList)]
    [InlineData("/api/files/abc/read", RiskActions.FileRead)]
    [InlineData("/api/othersoft/abc/qq", RiskActions.Qq)]
    [InlineData("/api/othersoft/abc/browser", RiskActions.Browser)]
    [InlineData("/api/othersoft/abc/ai", RiskActions.Ai)]
    public void ClassifyAction_MapsKnownPaths(string path, string expected)
    {
        Assert.Equal(expected, RiskClassifier.ClassifyAction("POST", path));
    }

    [Fact]
    public void ClassifyAction_FileDelete_UsesDelete()
    {
        Assert.Equal(RiskActions.FileDelete, RiskClassifier.ClassifyAction("DELETE", "/api/files/abc"));
    }

    [Fact]
    public void ClassifyAction_Task_RefinesByCommandType()
    {
        var body = "{\"agentId\":\"a\",\"commandType\":\"Screenshot\"}";
        Assert.Equal(RiskActions.ScreenMonitor, RiskClassifier.ClassifyAction("POST", "/api/tasks", body));
    }

    [Fact]
    public void ClassifyAction_Beacon_ReturnsNull()
    {
        Assert.Null(RiskClassifier.ClassifyAction("POST", "/api/beacon/heartbeat"));
    }

    [Fact]
    public void DefaultMappings_MatchExamples()
    {
        var m = RiskActions.DefaultMappings();
        Assert.Equal(RiskLevel.Safe, m[RiskActions.SystemInfo]);
        Assert.Equal(RiskLevel.Safe, m[RiskActions.Qq]);
        Assert.Equal(RiskLevel.Dangerous, m[RiskActions.ScreenMonitor]);
        Assert.Equal(RiskLevel.Dangerous, m[RiskActions.FileDelete]);
        Assert.Equal(RiskLevel.Dangerous, m[RiskActions.Browser]);
        Assert.Equal(RiskLevel.Malicious, m[RiskActions.Ai]);
        Assert.Equal(RiskLevel.Normal, m[RiskActions.FileList]);
    }
}
