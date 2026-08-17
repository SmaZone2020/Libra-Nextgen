using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;
using LibraNextgen.Common.Models;
using TaskStatusModel = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class TaskTools
{
    [McpServerTool, Description("List tasks with optional filters")]
    public static async Task<string> list_tasks(
        TaskService taskService,
        [Description("Filter by agent ID")] string? agentId = null,
        [Description("Filter by status: Pending, Running, Completed, Failed")] string? status = null,
        [Description("Page number (default 1)")] int page = 1,
        [Description("Page size (default 20)")] int pageSize = 20)
    {
        TaskStatusModel? statusFilter = status switch
        {
            "Pending" => TaskStatusModel.Pending,
            "Running" => TaskStatusModel.Running,
            "Completed" => TaskStatusModel.Completed,
            "Failed" => TaskStatusModel.Failed,
            _ => null
        };
        var tasks = await taskService.GetAllAsync(statusFilter, agentId, page, pageSize);
        return McpUtils.Limit(System.Text.Json.JsonSerializer.Serialize(tasks));
    }

    [McpServerTool, Description("Get task details by ID")]
    public static async Task<string> get_task(
        TaskService taskService,
        [Description("The task ID")] string taskId)
    {
        var task = await taskService.GetByIdAsync(taskId);
        if (task == null) return "Task not found";
        return McpUtils.Limit(System.Text.Json.JsonSerializer.Serialize(task));
    }

    [McpServerTool, Description("Create a new task for an agent")]
    public static async Task<string> create_task(
        TaskService taskService,
        [Description("Target agent ID")] string agentId,
        [Description("Command type: Shell, PowerShell, Upload, Download, Screenshot, Webcam, Kill, Sleep")] string commandType,
        [Description("The command string to execute")] string command,
        [Description("Timeout in seconds (default 60)")] int timeoutSeconds = 60)
    {
        if (!Enum.TryParse<CommandType>(commandType, true, out var cmdType))
            return $"Invalid command type: {commandType}";

        var request = new TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = cmdType,
            Command = command,
            TimeoutSeconds = timeoutSeconds
        };
        var task = await taskService.CreateAsync(request, "mcp-client");
        return System.Text.Json.JsonSerializer.Serialize(new { task.Id, task.Status });
    }

    [McpServerTool, Description("Cancel a pending task")]
    public static async Task<string> cancel_task(
        TaskService taskService,
        [Description("The task ID to cancel")] string taskId)
    {
        var count = await taskService.DeleteAsync(taskId);
        return count > 0 ? "Task cancelled" : "Task not found or already completed";
    }
}
