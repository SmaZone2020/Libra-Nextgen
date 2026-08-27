using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Http;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class DataTools
{
    [McpServerTool, Description("Scan for AI API keys ([OI], Anthropic, etc.) on an agent (requires Admin)")]
    public static async Task<string> scan_ai_tokens(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        CancellationToken ct = default)
    {
        var caller = McpUtils.GetCaller(http);
        var adminError = McpUtils.RequireAdmin(caller, "scan_ai_tokens");
        if (adminError.Length > 0) return adminError;

        return await McpUtils.RelayOrError(relay, agents, caller, agentId, "creds",
            new { op = "ai" }, ct, TimeSpan.FromSeconds(60));
    }
}
