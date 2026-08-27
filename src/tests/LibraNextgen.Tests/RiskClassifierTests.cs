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

    [Theory]
    [InlineData("/api/account")]
    [InlineData("/api/access-keys")]
    [InlineData("/api/builder/build")]
    [InlineData("/api/auth/login")]
    [InlineData("/api/mcp/toggle")]
    public void ClassifyAction_NonAgentOperations_ReturnNull(string path)
    {
        Assert.Null(RiskClassifier.ClassifyAction("POST", path));
    }

    [Fact]
    public void DefaultMappings_MatchExamples()
    {
        var m = RiskActions.DefaultMappings();
        Assert.Equal(RiskLevel.Safe, m[RiskActions.SystemInfo]);
        Assert.Equal(RiskLevel.Dangerous, m[RiskActions.ScreenMonitor]);
        Assert.Equal(RiskLevel.Dangerous, m[RiskActions.FileDelete]);
        Assert.Equal(RiskLevel.Malicious, m[RiskActions.Ai]);
        Assert.Equal(RiskLevel.Normal, m[RiskActions.FileList]);
    }

    [Theory]
    [InlineData("delete_file", RiskActions.FileDelete)]
    [InlineData("delete_agent", RiskActions.AgentDelete)]
    [InlineData("execute_shell", RiskActions.Shell)]
    [InlineData("execute_powershell", RiskActions.Shell)]
    [InlineData("execute_process", RiskActions.Shell)]
    [InlineData("spawn_process", RiskActions.ProcessSpawn)]
    [InlineData("kill_process", RiskActions.SystemProcessKill)]
    [InlineData("get_rdp_credentials", RiskActions.Credentials)]
    [InlineData("get_ssh_keys", RiskActions.Credentials)]
    [InlineData("scan_ai_tokens", RiskActions.Ai)]
    [InlineData("list_directory", RiskActions.FileList)]
    [InlineData("get_drives", RiskActions.FileDrives)]
    [InlineData("rename_file", RiskActions.FileRename)]
    [InlineData("move_file", RiskActions.FileMove)]
    [InlineData("copy_file", RiskActions.FileCopy)]
    [InlineData("get_processes", RiskActions.SystemProcesses)]
    [InlineData("get_network_info", RiskActions.SystemNetwork)]
    [InlineData("scan_wifi", RiskActions.SystemNetwork)]
    [InlineData("scan_lan", RiskActions.SystemLanScan)]
    [InlineData("create_task", RiskActions.TaskCreate)]
    public void ClassifyMcpTool_MapsKnownTools(string toolName, string expected)
    {
        Assert.Equal(expected, RiskClassifier.ClassifyMcpTool(toolName));
    }

    [Theory]
    [InlineData("list_agents")]
    [InlineData("get_agent")]
    [InlineData("list_tasks")]
    [InlineData("get_task")]
    [InlineData("cancel_task")]
    [InlineData("list_builds")]
    [InlineData("get_build_info")]
    [InlineData("unknown_tool")]
    [InlineData("")]
    public void ClassifyMcpTool_ReadOnlyOrUnknown_ReturnsNull(string toolName)
    {
        Assert.Null(RiskClassifier.ClassifyMcpTool(toolName));
    }

    [Fact]
    public void ClassifyMcpTool_Null_ReturnsNull()
    {
        Assert.Null(RiskClassifier.ClassifyMcpTool(null));
    }
}
