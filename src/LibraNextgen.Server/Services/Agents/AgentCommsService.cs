using LibraNextgen.Common.Models;
using LibraNextgen.Common.Profiles;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Profiles;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Services.Agents;

public class AgentCommsService
{
    private readonly IStore<Agent> _agents;
    private readonly IStore<TrafficRecord> _traffic;
    private readonly TaskService _taskService;
    private readonly ProfileService _profileService;
    private readonly AgentTrafficService _trafficAccumulator;
    private readonly SessionKeyStore _sessionKeys;

    public AgentCommsService(
        IStore<Agent> agents,
        IStore<TrafficRecord> traffic,
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
    public string? EstablishSessionKey(string agentId, string? publicKeyBase64, bool hasSessionKey)
    {
        if (string.IsNullOrWhiteSpace(publicKeyBase64))
            return null;

        if (hasSessionKey && _sessionKeys.TryGet(agentId, out var existing) && existing is not null)
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

    /// <summary>Issue a fresh opaque per-session channel token for an agent.</summary>
    public string IssueSessionToken(string agentId) => _sessionKeys.IssueToken(agentId);

    /// <summary>Resolve an opaque channel token to its agent id.</summary>
    public bool TryResolveSessionToken(string token, out string? agentId) =>
        _sessionKeys.TryResolveToken(token, out agentId);

    public async Task<Agent?> HandleRegisterAsync(RegisterRequest request, string clientIp, int heartbeatIntervalSeconds = 30)
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
            var intervalMs = HeartbeatTiming.ResolveIntervalMs(request, heartbeatIntervalSeconds);
            var intervalSeconds = (int)Math.Ceiling(intervalMs / 1_000.0);
            var updates = new List<FieldUpdate>
            {
                new(nameof(Agent.Status), AgentStatus.Online),
                new(nameof(Agent.LastSeen), DateTime.UtcNow),
                new(nameof(Agent.IpAddress), clientIp),
                new(nameof(Agent.Pid), request.Pid),
                new(nameof(Agent.IsElevated), request.IsElevated),
                new(nameof(Agent.OsVersion), request.OsVersion),
                new(nameof(Agent.Arch), request.Arch),
                new(nameof(Agent.ProcessName), request.ProcessName),
                new(nameof(Agent.PublicKey), request.PublicKey),
                new(nameof(Agent.Hwid), hwid),
                new(nameof(Agent.HeartbeatInterval), intervalSeconds),
                new(nameof(Agent.HeartbeatIntervalMs), intervalMs),
            };
            if (request.Hardware != null)
                updates.Add(new FieldUpdate(nameof(Agent.Hardware), request.Hardware));
            await _agents.UpdateByIdAsync(existing.Id, updates);
            existing.Status = AgentStatus.Online;
            existing.IpAddress = clientIp;
            existing.Pid = request.Pid;
            existing.IsElevated = request.IsElevated;
            existing.OsVersion = request.OsVersion;
            existing.Arch = request.Arch;
            existing.ProcessName = request.ProcessName;
            existing.PublicKey = request.PublicKey;
            existing.Hardware = request.Hardware;
            existing.Hwid = hwid;
            existing.HeartbeatInterval = intervalSeconds;
            existing.HeartbeatIntervalMs = intervalMs;
            return existing;
        }

        var heartbeatIntervalMs = HeartbeatTiming.ResolveIntervalMs(request, heartbeatIntervalSeconds);
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
            HeartbeatInterval = (int)Math.Ceiling(heartbeatIntervalMs / 1_000.0),
            HeartbeatIntervalMs = heartbeatIntervalMs,
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

        await TouchLastSeenAsync(agentId);

        var task = await _taskService.GetNextPendingForAgentAsync(agentId);
        if (task != null)
        {
            await _taskService.UpdateStatusAsync(task.Id, TaskStatus.Sent);
        }

        return (true, task, agent.Hostname);
    }

    /// <summary>
    /// Refresh an agent's liveness without pulling a task. Used by the SSE event
    /// stream: a live connection (and its keepalives) is proof the agent process
    /// is still alive, so transient heartbeat failures won't knock it offline.
    /// </summary>
    public async Task TouchLastSeenAsync(string agentId)
    {
        await _agents.UpdateByIdAsync(agentId, new[]
        {
            new FieldUpdate(nameof(Agent.LastSeen), DateTime.UtcNow),
            new FieldUpdate(nameof(Agent.Status), AgentStatus.Online),
        });
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
    public bool HasSessionKey { get; set; }
    public long? HeartbeatIntervalMs { get; set; }
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
