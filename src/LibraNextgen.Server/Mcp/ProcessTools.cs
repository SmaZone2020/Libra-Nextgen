using System.ComponentModel;
using ModelContextProtocol.Server;
using Microsoft.AspNetCore.Http;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// fork-and-run tools: execute/spawn OS programs in a fresh child process on
/// the agent (forkexec cloud module), isolated from the agent process itself.
/// </summary>
[McpServerToolType]
public sealed class ProcessTools
{
    [McpServerTool, Description("Execute an OS program in a fresh child process on an agent and wait for the result (isolated from the agent process; supports args, env overrides, cwd and timeout)")]
    public static async Task<string> execute_process(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Program to execute (absolute path or name resolved via PATH)")] string program,
        [Description("Arguments (optional)")] string[]? args = null,
        [Description("Environment overrides as \"KEY=value\" entries (optional)")] string[]? env = null,
        [Description("Working directory (optional)")] string? cwd = null,
        [Description("Timeout in seconds (default 30)")] int timeoutSeconds = 30,
        CancellationToken ct = default)
    {
        var caller = McpUtils.GetCaller(http);
        return await McpUtils.RelayOrError(relay, agents, caller, agentId, "forkexec", new
        {
            op = "run",
            program,
            args = args ?? Array.Empty<string>(),
            env = EnvPairs(env),
            cwd,
            timeoutSeconds = Math.Clamp(timeoutSeconds, 1, 600),
        }, ct, TimeSpan.FromSeconds(Math.Clamp(timeoutSeconds, 1, 600) + 20));
    }

    [McpServerTool, Description("Spawn a detached background process on an agent and return its PID without waiting (requires Admin)")]
    public static async Task<string> spawn_process(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Program to execute (absolute path or name resolved via PATH)")] string program,
        [Description("Arguments (optional)")] string[]? args = null,
        [Description("Environment overrides as \"KEY=value\" entries (optional)")] string[]? env = null,
        [Description("Working directory (optional)")] string? cwd = null,
        CancellationToken ct = default)
    {
        var caller = McpUtils.GetCaller(http);
        var adminError = McpUtils.RequireAdmin(caller, "spawn_process");
        if (adminError.Length > 0) return adminError;

        return await McpUtils.RelayOrError(relay, agents, caller, agentId, "forkexec", new
        {
            op = "spawn",
            program,
            args = args ?? Array.Empty<string>(),
            env = EnvPairs(env),
            cwd,
        }, ct, TimeSpan.FromSeconds(30));
    }

    /// <summary>Parse "KEY=value" entries into an env object for the agent module.</summary>
    private static Dictionary<string, string>? EnvPairs(string[]? env)
    {
        if (env == null || env.Length == 0) return null;
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var pair in env)
        {
            var idx = pair.IndexOf('=');
            if (idx <= 0) continue;
            map[pair[..idx]] = pair[(idx + 1)..];
        }
        return map.Count > 0 ? map : null;
    }
}
