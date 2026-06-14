using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class SystemTools
{
    [McpServerTool, Description("Get the list of running processes on an agent")]
    public static async Task<string> get_processes(
        RelayService relay,
        [Description("Target agent ID")] string agentId)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "system.processes", null, CancellationToken.None);
        return result?.Data?.ToString() ?? "No response from agent";
    }

    [McpServerTool, Description("Kill a process by PID on an agent")]
    public static async Task<string> kill_process(
        TaskService taskService,
        [Description("Target agent ID")] string agentId,
        [Description("Process ID to kill")] int pid)
    {
        var request = new Common.Models.TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = Common.Models.CommandType.Kill,
            Command = pid.ToString(),
            TimeoutSeconds = 10
        };
        var task = await taskService.CreateAsync(request, "mcp-client");
        return JsonSerializer.Serialize(new { task.Id, task.Status });
    }

    [McpServerTool, Description("Get network configuration (interfaces, WAN, WiFi, proxy) from an agent")]
    public static async Task<string> get_network_info(
        RelayService relay,
        [Description("Target agent ID")] string agentId)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "system.network", null, CancellationToken.None);
        return result?.Data?.ToString() ?? "No response from agent";
    }

    [McpServerTool, Description("Scan saved WiFi profiles and passwords on an agent")]
    public static async Task<string> scan_wifi(
        TaskService taskService,
        [Description("Target agent ID")] string agentId)
    {
        var request = new Common.Models.TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = Common.Models.CommandType.WifiScan,
            Command = "scan",
            TimeoutSeconds = 30
        };
        var task = await taskService.CreateAsync(request, "mcp-client");
        return JsonSerializer.Serialize(new { task.Id, task.Status, message = "WiFi scan task created." });
    }

    [McpServerTool, Description("Scan the LAN for nearby devices via ARP/ICMP")]
    public static async Task<string> scan_lan(
        RelayService relay,
        [Description("Target agent ID")] string agentId)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "system.lanscan", null, CancellationToken.None, TimeSpan.FromSeconds(60));
        return result?.Data?.ToString() ?? "No response from agent (timeout 60s)";
    }
}
