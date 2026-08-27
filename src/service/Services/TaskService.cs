using System.Linq.Expressions;
using LibraNextgen.Common.Authorization;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using MongoDB.Driver;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Services;

public class TaskService
{
    private readonly Repository<AgentTask> _tasks;
    private readonly ConnectionManager _wsManager;
    private readonly AgentEventHub _eventHub;

    public TaskService(Repository<AgentTask> tasks, ConnectionManager wsManager, AgentEventHub eventHub)
    {
        _tasks = tasks;
        _wsManager = wsManager;
        _eventHub = eventHub;
    }

    public async Task<List<AgentTask>> GetAllAsync(
        TaskStatus? status = null,
        string? agentId = null,
        int page = 1,
        int pageSize = 50,
        CancellationToken ct = default)
    {
        var filter = BuildFilter(status, agentId);
        var sort = Builders<AgentTask>.Sort.Descending(t => t.CreatedAt);
        return await _tasks.FindPagedAsync(filter, page, pageSize, sort, ct);
    }

    /// <summary>
    /// Builds a native MongoDB filter. Combining expressions with
    /// <c>filter.Compile()(t)</c> inside a new lambda is not translatable by the
    /// driver, so we compose FilterDefinitions directly instead.
    /// </summary>
    public static FilterDefinition<AgentTask> BuildFilter(TaskStatus? status, string? agentId)
    {
        var filters = CollectFilters(status, agentId);
        return filters.Count > 0
            ? Builders<AgentTask>.Filter.And(filters)
            : Builders<AgentTask>.Filter.Empty;
    }

    public static IReadOnlyList<FilterDefinition<AgentTask>> CollectFilters(TaskStatus? status, string? agentId)
    {
        var builder = Builders<AgentTask>.Filter;
        var filters = new List<FilterDefinition<AgentTask>>();

        if (status.HasValue)
            filters.Add(builder.Eq(t => t.Status, status.Value));

        if (!string.IsNullOrEmpty(agentId))
            filters.Add(builder.Eq(t => t.AgentId, agentId));

        return filters;
    }

    public async Task<AgentTask?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        return await _tasks.GetByIdAsync(id, ct);
    }

    /// <summary>
    /// Create a task. Admin-gated command types (Kill, KillAndClean, Restart,
    /// LocalAccounts) are rejected for non-admin callers regardless of entry
    /// point (REST controller or MCP) — this is the single enforcement chokepoint.
    /// </summary>
    public async Task<AgentTask> CreateAsync(TaskCreateRequest request, string createdBy, bool isAdmin, CancellationToken ct = default)
    {
        if (CommandAuthorization.RequiresAdmin(request.CommandType) && !isAdmin)
            throw new UnauthorizedAccessException(
                $"command type '{request.CommandType}' requires an Admin");

        var task = new AgentTask
        {
            AgentId = request.AgentId,
            CreatedBy = createdBy,
            CommandType = request.CommandType,
            Command = request.Command,
            Arguments = request.Arguments,
            TimeoutSeconds = request.TimeoutSeconds,
            Status = TaskStatus.Pending
        };
        await _tasks.InsertAsync(task, ct);
        _wsManager.AppendEvent("task", $"操作员 {createdBy} 向 Agent {request.AgentId} 下发任务 {request.CommandType}");
        // SSE 即时推送（agent 在线且订阅时；否则下个心跳兜底拉取）
        _eventHub.Push(request.AgentId, "task", task);
        return task;
    }

    public async Task<AgentTask?> GetNextPendingForAgentAsync(string agentId, CancellationToken ct = default)
    {
        var tasks = await _tasks.FindPagedAsync(
            t => t.AgentId == agentId && t.Status == TaskStatus.Pending,
            1, 1, Builders<AgentTask>.Sort.Ascending(t => t.CreatedAt), ct);
        return tasks.FirstOrDefault();
    }

    public async Task UpdateStatusAsync(string id, TaskStatus status, string? output = null, string? error = null, CancellationToken ct = default)
    {
        var update = Builders<AgentTask>.Update.Set(t => t.Status, status);
        if (output != null)
            update = update.Set(t => t.Output, output);
        if (error != null)
            update = update.Set(t => t.Error, error);

        if (status == TaskStatus.Sent)
            update = update.Set(t => t.DispatchedAt, DateTime.UtcNow);
        if (status is TaskStatus.Completed or TaskStatus.Failed)
            update = update.Set(t => t.CompletedAt, DateTime.UtcNow);

        await _tasks.UpdateAsync(id, update, ct);
    }

    public async Task<long> CancelPendingAsync(string agentId, CancellationToken ct = default)
    {
        var update = Builders<AgentTask>.Update.Set(t => t.Status, TaskStatus.Cancelled);
        return await _tasks.UpdateOneAsync(t => t.AgentId == agentId && t.Status == TaskStatus.Pending, update, ct);
    }

    /// <summary>
    /// Soft-cancel a single pending task (record is kept for audit/retrospection,
    /// unlike a hard delete). No-op when the task is not found or already
    /// dispatched to the agent.
    /// </summary>
    public async Task<long> CancelPendingByIdAsync(string id, CancellationToken ct = default)
    {
        var update = Builders<AgentTask>.Update.Set(t => t.Status, TaskStatus.Cancelled);
        return await _tasks.UpdateOneAsync(t => t.Id == id && t.Status == TaskStatus.Pending, update, ct);
    }

    public async Task<long> DeleteAsync(string id, CancellationToken ct = default)
    {
        return await _tasks.DeleteAsync(id, ct);
    }

    public async Task<long> CountAsync(TaskStatus? status = null, CancellationToken ct = default)
    {
        if (status.HasValue)
            return await _tasks.CountAsync(t => t.Status == status.Value, ct);
        return await _tasks.CountAsync(ct: ct);
    }

    /// <summary>
    /// Polls until the task reaches a terminal state (Completed/Failed/Cancelled)
    /// or the timeout elapses. Used by MCP tools so a single call can return the
    /// final result instead of making the client poll get_task manually.
    /// </summary>
    public async Task<AgentTask?> WaitForCompletionAsync(string id, TimeSpan? timeout, CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(60));
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            var task = await GetByIdAsync(id, ct);
            if (task == null) return null;
            if (task.Status is TaskStatus.Completed or TaskStatus.Failed or TaskStatus.Cancelled)
                return task;
            await Task.Delay(500, ct);
        }
        return await GetByIdAsync(id, ct);
    }
}
