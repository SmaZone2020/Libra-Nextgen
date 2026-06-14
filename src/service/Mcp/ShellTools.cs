using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class ShellTools
{
    [McpServerTool, Description("Execute a shell command on an agent and wait for the result")]
    public static async Task<string> execute_shell(
        TaskService taskService,
        [Description("Target agent ID")] string agentId,
        [Description("Shell command to execute")] string command,
        [Description("Timeout in seconds (default 30)")] int timeoutSeconds = 30)
    {
        var request = new Common.Models.TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = Common.Models.CommandType.Shell,
            Command = command,
            TimeoutSeconds = timeoutSeconds
        };
        var task = await taskService.CreateAsync(request, "mcp-client");
        return JsonSerializer.Serialize(new { task.Id, task.Status, message = "Task created. Poll get_task for results." });
    }

    [McpServerTool, Description("Execute a PowerShell command on an agent")]
    public static async Task<string> execute_powershell(
        TaskService taskService,
        [Description("Target agent ID")] string agentId,
        [Description("PowerShell command or script")] string command,
        [Description("Timeout in seconds (default 30)")] int timeoutSeconds = 30)
    {
        var request = new Common.Models.TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = Common.Models.CommandType.PowerShell,
            Command = command,
            TimeoutSeconds = timeoutSeconds
        };
        var task = await taskService.CreateAsync(request, "mcp-client");
        return JsonSerializer.Serialize(new { task.Id, task.Status, message = "Task created. Poll get_task for results." });
    }
}
