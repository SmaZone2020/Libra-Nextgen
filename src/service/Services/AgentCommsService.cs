using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Profiles;
using MongoDB.Driver;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Services;

public class AgentCommsService
{
    private readonly Repository<Agent> _agents;
    private readonly TaskService _taskService;
    private readonly ProfileService _profileService;

    public AgentCommsService(
        Repository<Agent> agents,
        TaskService taskService,
        ProfileService profileService)
    {
        _agents = agents;
        _taskService = taskService;
        _profileService = profileService;
    }

    public DefaultProfile GetActiveProfile() =>
        (DefaultProfile)_profileService.GetActiveProfile();

    public async Task<Agent?> HandleRegisterAsync(RegisterRequest request, string clientIp)
    {
        var existing = await _agents.FirstOrDefaultAsync(a => a.Hostname == request.Hostname && a.UserName == request.UserName);
        if (existing != null)
        {
            var ub = Builders<Agent>.Update;
            var update = Builders<Agent>.Update.Combine(
                ub.Set(a => a.Status, AgentStatus.Online),
                ub.Set(a => a.LastSeen, DateTime.UtcNow),
                ub.Set(a => a.IpAddress, clientIp),
                ub.Set(a => a.Pid, request.Pid),
                ub.Set(a => a.IsElevated, request.IsElevated),
                ub.Set(a => a.OsVersion, request.OsVersion),
                ub.Set(a => a.Arch, request.Arch),
                ub.Set(a => a.ProcessName, request.ProcessName),
                ub.Set(a => a.PublicKey, request.PublicKey)
            );
            await _agents.UpdateAsync(existing.Id, update);
            existing.PublicKey = request.PublicKey;
            return existing;
        }

        var agent = new Agent
        {
            Hostname = request.Hostname,
            UserName = request.UserName,
            IpAddress = clientIp,
            OsVersion = request.OsVersion,
            Arch = request.Arch,
            ProcessName = request.ProcessName,
            Pid = request.Pid,
            IsElevated = request.IsElevated,
            PublicKey = request.PublicKey,
            Status = AgentStatus.Online
        };
        await _agents.InsertAsync(agent);
        return agent;
    }

    public async Task<(bool valid, AgentTask? task)> HandleHeartbeatAsync(
        string agentId, byte[] sessionKey)
    {
        var agent = await _agents.GetByIdAsync(agentId);
        if (agent == null)
            return (false, null);

        var ub = Builders<Agent>.Update;
        var update = Builders<Agent>.Update.Combine(
            ub.Set(a => a.LastSeen, DateTime.UtcNow),
            ub.Set(a => a.Status, AgentStatus.Online));
        await _agents.UpdateAsync(agentId, update);

        var task = await _taskService.GetNextPendingForAgentAsync(agentId);
        if (task != null)
        {
            await _taskService.UpdateStatusAsync(task.Id, TaskStatus.Sent);
        }

        return (true, task);
    }

    public async Task<bool> HandleResultAsync(
        string agentId, TaskResult result, byte[] sessionKey)
    {
        var task = await _taskService.GetByIdAsync(result.TaskId);
        if (task == null || task.AgentId != agentId)
            return false;

        await _taskService.UpdateStatusAsync(
            result.TaskId,
            result.Success ? TaskStatus.Completed : TaskStatus.Failed,
            result.Output,
            result.Error);
        return true;
    }
}

public class RegisterRequest
{
    public string Hostname { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public string OsVersion { get; set; } = string.Empty;
    public string Arch { get; set; } = string.Empty;
    public string ProcessName { get; set; } = string.Empty;
    public int Pid { get; set; }
    public bool IsElevated { get; set; }
    public string? PublicKey { get; set; }
}

public class HeartbeatResponse
{
    public string Status { get; set; } = "ok";
    public AgentTask? PendingTask { get; set; }
}

public class TaskResult
{
    public string TaskId { get; set; } = string.Empty;
    public bool Success { get; set; }
    public string? Output { get; set; }
    public string? Error { get; set; }
}
