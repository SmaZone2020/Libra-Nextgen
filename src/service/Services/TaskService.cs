using System.Linq.Expressions;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using MongoDB.Driver;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Services;

public class TaskService
{
    private readonly Repository<AgentTask> _tasks;

    public TaskService(Repository<AgentTask> tasks)
    {
        _tasks = tasks;
    }

    public async Task<List<AgentTask>> GetAllAsync(
        TaskStatus? status = null,
        string? agentId = null,
        int page = 1,
        int pageSize = 50,
        CancellationToken ct = default)
    {
        Expression<Func<AgentTask, bool>> filter = t => true;

        if (status.HasValue)
            filter = t => t.Status == status.Value;

        if (!string.IsNullOrEmpty(agentId))
        {
            var agentFilter = filter;
            filter = t => agentFilter.Compile()(t) && t.AgentId == agentId;
        }

        var sort = Builders<AgentTask>.Sort.Descending(t => t.CreatedAt);
        return await _tasks.FindPagedAsync(filter, page, pageSize, sort, ct);
    }

    public async Task<AgentTask?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        return await _tasks.GetByIdAsync(id, ct);
    }

    public async Task<AgentTask> CreateAsync(TaskCreateRequest request, string createdBy, CancellationToken ct = default)
    {
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
}
