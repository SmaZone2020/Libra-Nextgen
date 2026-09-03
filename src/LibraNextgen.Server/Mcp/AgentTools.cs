using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;
using LibraNextgen.Common.Models;
using Microsoft.AspNetCore.Http;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class AgentTools
{
    [McpServerTool, Description("List all connected agents with optional status filter")]
    public static async Task<string> list_agents(
        AgentService agentService,
        [Description("Filter by status: Online, Offline, or omit for all")] string? status = null,
        CancellationToken ct = default)
    {
        if (!string.IsNullOrEmpty(status) && status is not ("Online" or "Offline"))
            return McpUtils.Error($"invalid status '{status}' (expected Online or Offline)");

        AgentStatus? filter = status == "Online" ? AgentStatus.Online
            : status == "Offline" ? AgentStatus.Offline : null;

        var agents = await agentService.GetAllAsync(status: filter, ct: ct);
        return McpUtils.Limit(JsonSerializer.Serialize(agents, McpUtils.JsonOpts));
    }

    [McpServerTool, Description("Get detailed information about a specific agent")]
    public static async Task<string> get_agent(
        AgentService agentService,
        [Description("The agent ID")] string agentId,
        CancellationToken ct = default)
    {
        var agent = await agentService.GetByIdAsync(agentId, ct);
        if (agent == null) return McpUtils.Error($"agent '{agentId}' not found");
        return McpUtils.Limit(JsonSerializer.Serialize(agent, McpUtils.JsonOpts));
    }

    [McpServerTool, Description("Delete/remove an agent from the system (requires Admin). Cancels its pending tasks and revokes its session key; a live agent process keeps running until its next heartbeat fails")]
    public static async Task<string> delete_agent(
        IHttpContextAccessor http,
        AgentService agentService,
        TaskService taskService,
        SessionKeyStore sessionKeys,
        [Description("The agent ID to delete")] string agentId,
        CancellationToken ct = default)
    {
        var caller = McpUtils.GetCaller(http);
        var adminError = McpUtils.RequireAdmin(caller, "delete_agent");
        if (adminError.Length > 0) return adminError;

        var cancelled = await taskService.CancelPendingAsync(agentId, ct);
        sessionKeys.Remove(agentId);
        var count = await agentService.DeleteAsync(agentId, ct);

        return count > 0
            ? McpUtils.Ok(new { deleted = true, agentId, pendingTasksCancelled = cancelled })
            : McpUtils.Error($"agent '{agentId}' not found");
    }
}
