using System.Text.Json;
using LibraNextgen.Common.Models;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Services.Tasks;

/// <summary>
/// </summary>
public class RelayService
{
    private readonly TaskService _tasks;
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(60);

    /// <summary>
    /// </summary>
    public static readonly HashSet<string> IsolatedModules = new(StringComparer.Ordinal)
    {
        "creds",
    };

    public static bool IsIsolatedModule(string module) => IsolatedModules.Contains(module);

    public RelayService(TaskService tasks)
    {
        _tasks = tasks;
    }

    /// <summary>
    ///
    /// </summary>
    public async Task<string?> RelayAndWaitAsync(
        string agentId, string module, object? data,
        CancellationToken ct, TimeSpan? timeout = null, string? createdBy = null)
    {
        var total = timeout ?? DefaultTimeout;
        var arguments = new List<string> { JsonSerializer.Serialize(data ?? new { }) };
        if (IsIsolatedModule(module))
            arguments.Add("isolated=true");
        var created = await _tasks.CreateAsync(new TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = CommandType.Generic,
            Command = module,
            Arguments = arguments.ToArray(),
            TimeoutSeconds = Math.Clamp((int)total.TotalSeconds, 5, 3600),
        }, createdBy ?? "system-relay", isAdmin: true, ct);

        AgentTask? done;
        try
        {
            done = await _tasks.WaitForCompletionAsync(created.Id, total, ct);
        }
        catch (OperationCanceledException)
        {
            await SafeCancelPendingAsync(created.Id);
            throw;
        }

        if (done == null || done.Status != TaskStatus.Completed)
        {
            if (done?.Status == TaskStatus.Pending)
                await SafeCancelPendingAsync(created.Id);
            return null;
        }
        return done.Output;
    }

    private async Task SafeCancelPendingAsync(string taskId)
    {
        try
        {
            await _tasks.CancelPendingByIdAsync(taskId, CancellationToken.None);
        }
        catch
        {
            // Best-effort cleanup only; never mask the original failure.
        }
    }
}
