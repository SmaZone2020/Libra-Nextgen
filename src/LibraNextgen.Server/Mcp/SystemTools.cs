using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Common.Models;
using Microsoft.AspNetCore.Http;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class SystemTools
{
    [McpServerTool, Description("Get the list of running processes on an agent")]
    public static async Task<string> get_processes(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        CancellationToken ct = default)
    {
        return await McpUtils.RelayOrError(relay, agents, McpUtils.GetCaller(http), agentId, "recon",
            new { op = "processes" }, ct, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Kill a process by PID on an agent (requires Admin)")]
    public static async Task<string> kill_process(
        IHttpContextAccessor http,
        TaskService taskService,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Process ID to kill")] int pid,
        CancellationToken ct = default)
    {
        // CommandType.Kill is admin-gated inside TaskService.CreateAsync.
        return await McpUtils.CreateTaskAndWait(
            taskService, agents, McpUtils.GetCaller(http),
            agentId, CommandType.Kill, pid.ToString(), 10, null, ct);
    }

    [McpServerTool, Description("Get network configuration (interfaces, WAN, WiFi, proxy) from an agent")]
    public static async Task<string> get_network_info(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        CancellationToken ct = default)
    {
        return await McpUtils.RelayOrError(relay, agents, McpUtils.GetCaller(http), agentId, "recon",
            new { op = "network" }, ct, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Scan saved WiFi profiles and passwords on an agent")]
    public static async Task<string> scan_wifi(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        CancellationToken ct = default)
    {
        return await McpUtils.RelayOrError(relay, agents, McpUtils.GetCaller(http), agentId, "recon",
            new { op = "network.wifi" }, ct, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Scan the LAN for nearby devices via ARP/ICMP")]
    public static async Task<string> scan_lan(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        CancellationToken ct = default)
    {
        return await McpUtils.RelayOrError(relay, agents, McpUtils.GetCaller(http), agentId, "recon",
            new { op = "lanscan" }, ct, TimeSpan.FromSeconds(60));
    }
}
