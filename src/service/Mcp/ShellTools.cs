using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class ShellTools
{
    [McpServerTool, Description("Execute a shell command on an agent and wait for the result")]
    public static async Task<string> execute_shell(
        TaskService taskService,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Shell command to execute")] string command,
        [Description("Timeout in seconds (default 30)")] int timeoutSeconds = 30)
    {
        return await McpUtils.CreateTaskAndWait(
            taskService, agents, agentId, CommandType.Shell, command, timeoutSeconds);
    }

    [McpServerTool, Description("Execute a PowerShell command on an agent and wait for the result")]
    public static async Task<string> execute_powershell(
        TaskService taskService,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("PowerShell command or script")] string command,
        [Description("Timeout in seconds (default 30)")] int timeoutSeconds = 30)
    {
        return await McpUtils.CreateTaskAndWait(
            taskService, agents, agentId, CommandType.PowerShell, command, timeoutSeconds);
    }
}