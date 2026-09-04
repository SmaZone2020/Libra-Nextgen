using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using LibraNextgen.Common.Models;
using Microsoft.AspNetCore.Http;
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
        [Description("Page size (default 20)")] int pageSize = 20,
        CancellationToken ct = default)
    {
        TaskStatusModel? statusFilter = status switch
        {
            "Pending" => TaskStatusModel.Pending,
            "Running" => TaskStatusModel.Running,
            "Completed" => TaskStatusModel.Completed,
            "Failed" => TaskStatusModel.Failed,
            _ => null
        };
        var tasks = await taskService.GetAllAsync(statusFilter, agentId, page, pageSize, ct);
        return McpUtils.Limit(JsonSerializer.Serialize(tasks, McpUtils.JsonOpts));
    }

    [McpServerTool, Description("Get task details by ID")]
    public static async Task<string> get_task(
        TaskService taskService,
        [Description("The task ID")] string taskId,
        CancellationToken ct = default)
    {
        var task = await taskService.GetByIdAsync(taskId, ct);
        if (task == null) return McpUtils.Error($"task '{taskId}' not found");
        return McpUtils.Limit(JsonSerializer.Serialize(task, McpUtils.JsonOpts));
    }

    [McpServerTool, Description("Create a new task for an agent (fire-and-forget; use execute_shell to wait for the result). Admin-gated command types are enforced server-side")]
    public static async Task<string> create_task(
        IHttpContextAccessor http,
        TaskService taskService,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Command type: Shell, PowerShell, Upload, Download, Screenshot, Webcam, Kill, Sleep")] string commandType,
        [Description("The command string to execute")] string command,
        [Description("Timeout in seconds (default 60)")] int timeoutSeconds = 60,
        CancellationToken ct = default)
    {
        if (!Enum.TryParse<CommandType>(commandType, true, out var cmdType))
            return McpUtils.Error($"invalid command type '{commandType}'");

        if (string.IsNullOrWhiteSpace(agentId))
            return McpUtils.Error("agentId is required");

        if (!await McpUtils.IsOnlineAsync(agents, agentId))
            return McpUtils.Error($"agent '{agentId}' is offline or not found");

        var caller = McpUtils.GetCaller(http);
        var request = new TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = cmdType,
            Command = command,
            TimeoutSeconds = Math.Clamp(timeoutSeconds, 1, 3600)
        };

        AgentTask task;
        try
        {
            task = await taskService.CreateAsync(request, caller.UserName, caller.IsAdmin, ct);
        }
        catch (UnauthorizedAccessException ex)
        {
            return McpUtils.Error(ex.Message);
        }

        return JsonSerializer.Serialize(new { task.Id, task.Status }, McpUtils.JsonOpts);
    }

    [McpServerTool, Description("Cancel a pending task (soft cancel; the record is kept for audit)")]
    public static async Task<string> cancel_task(
        TaskService taskService,
        [Description("The task ID to cancel")] string taskId,
        CancellationToken ct = default)
    {
        var count = await taskService.CancelPendingByIdAsync(taskId, ct);
        return count > 0
            ? McpUtils.Ok(new { cancelled = true, taskId })
            : McpUtils.Error("task not found or already dispatched/completed");
    }
}
