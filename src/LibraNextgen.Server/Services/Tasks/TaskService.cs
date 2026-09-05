using System.Linq.Expressions;
using LibraNextgen.Common.Authorization;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Services.Tasks;

public class TaskService
{
    private readonly IStore<AgentTask> _tasks;
    private readonly ConnectionManager _wsManager;
    private readonly AgentEventHub _eventHub;

    public TaskService(IStore<AgentTask> tasks, ConnectionManager wsManager, AgentEventHub eventHub)
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
        return await _tasks.FindPagedAsync(filter, page, pageSize, nameof(AgentTask.CreatedAt), true, ct);
    }

    /// <summary>
    /// Compose the optional criteria into one provider-neutral predicate.
    /// Sub-expressions are joined with AndAlso (no Expression.Invoke) so the
    /// Mongo LINQ translator can map them server-side.
    /// </summary>
    public static Expression<Func<AgentTask, bool>> BuildFilter(TaskStatus? status, string? agentId)
    {
        Expression<Func<AgentTask, bool>>? filter = null;

        if (status.HasValue)
            filter = t => t.Status == status.Value;

        if (!string.IsNullOrEmpty(agentId))
        {
            filter = filter is null
                ? t => t.AgentId == agentId
                : ExpressionCombine.AndAlso(filter, t => t.AgentId == agentId);
        }

        return filter ?? (_ => true);
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
        _eventHub.Push(request.AgentId, "task", task);
        return task;
    }

    public async Task<AgentTask?> GetNextPendingForAgentAsync(string agentId, CancellationToken ct = default)
    {
        var tasks = await _tasks.FindPagedAsync(
            t => t.AgentId == agentId && t.Status == TaskStatus.Pending,
            1, 1, nameof(AgentTask.CreatedAt), false, ct);
        return tasks.FirstOrDefault();
    }

    public async Task UpdateStatusAsync(string id, TaskStatus status, string? output = null, string? error = null, CancellationToken ct = default)
    {
        var updates = new List<FieldUpdate>
        {
            new(nameof(AgentTask.Status), status),
        };
        if (output != null)
            updates.Add(new FieldUpdate(nameof(AgentTask.Output), output));
        if (error != null)
            updates.Add(new FieldUpdate(nameof(AgentTask.Error), error));
        if (status == TaskStatus.Sent)
            updates.Add(new FieldUpdate(nameof(AgentTask.DispatchedAt), DateTime.UtcNow));
        if (status is TaskStatus.Completed or TaskStatus.Failed)
            updates.Add(new FieldUpdate(nameof(AgentTask.CompletedAt), DateTime.UtcNow));

        await _tasks.UpdateByIdAsync(id, updates, ct);
    }

    public async Task<long> CancelPendingAsync(string agentId, CancellationToken ct = default)
    {
        return await _tasks.UpdateOneAsync(
            t => t.AgentId == agentId && t.Status == TaskStatus.Pending,
            new[] { new FieldUpdate(nameof(AgentTask.Status), TaskStatus.Cancelled) }, ct);
    }

    /// <summary>
    /// Soft-cancel a single pending task (record is kept for audit/retrospection,
    /// unlike a hard delete). No-op when the task is not found or already
    /// dispatched to the agent.
    /// </summary>
    public async Task<long> CancelPendingByIdAsync(string id, CancellationToken ct = default)
    {
        return await _tasks.UpdateOneAsync(
            t => t.Id == id && t.Status == TaskStatus.Pending,
            new[] { new FieldUpdate(nameof(AgentTask.Status), TaskStatus.Cancelled) }, ct);
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
