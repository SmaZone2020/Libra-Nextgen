using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class AgentTools
{
    [McpServerTool, Description("List all connected agents with optional status filter")]
    public static async Task<string> list_agents(
        AgentService agentService,
        [Description("Filter by status: Online, Offline, or omit for all")] string? status = null)
    {
        AgentStatus? filter = status switch
        {
            "Online" => AgentStatus.Online,
            "Offline" => AgentStatus.Offline,
            _ => null
        };
        var agents = await agentService.GetAllAsync(status: filter);
        return McpUtils.Limit(System.Text.Json.JsonSerializer.Serialize(agents));
    }

    [McpServerTool, Description("Get detailed information about a specific agent")]
    public static async Task<string> get_agent(
        AgentService agentService,
        [Description("The agent ID")] string agentId)
    {
        var agent = await agentService.GetByIdAsync(agentId);
        if (agent == null) return "Agent not found";
        return System.Text.Json.JsonSerializer.Serialize(agent);
    }

    [McpServerTool, Description("Delete/remove an agent from the system")]
    public static async Task<string> delete_agent(
        AgentService agentService,
        [Description("The agent ID to delete")] string agentId)
    {
        var count = await agentService.DeleteAsync(agentId);
        return count > 0 ? "Agent deleted" : "Agent not found";
    }
}
