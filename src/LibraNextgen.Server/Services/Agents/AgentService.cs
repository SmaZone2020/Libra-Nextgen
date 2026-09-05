using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services.Agents;

public class AgentService
{
    private readonly IStore<Agent> _agents;
    private readonly AgentEventHub _eventHub;

    public AgentService(IStore<Agent> agents, AgentEventHub eventHub)
    {
        _agents = agents;
        _eventHub = eventHub;
    }

    public async Task<List<AgentListItem>> GetAllAsync(int page = 1, int pageSize = 50, AgentStatus? status = null, CancellationToken ct = default)
    {
        var filter = status is null
            ? (System.Linq.Expressions.Expression<Func<Agent, bool>>)(a => true)
            : a => a.Status == status.Value;
        var agents = await _agents.FindPagedAsync(filter, page, pageSize, nameof(Agent.FirstSeen), true, ct);
        return agents.Select(MapToList).ToList();
    }

    public async Task<AgentDetail?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var agent = await _agents.GetByIdAsync(id, ct);
        return agent == null ? null : MapToDetail(agent);
    }

    public async Task<List<Agent>> GetOnlineAsync(CancellationToken ct = default)
    {
        return await _agents.FindAsync(a => a.Status == AgentStatus.Online, ct);
    }

    public async Task UpdateStatusAsync(string id, AgentStatus status, CancellationToken ct = default)
    {
        await _agents.UpdateByIdAsync(id, new[]
        {
            new FieldUpdate(nameof(Agent.Status), status),
            new FieldUpdate(nameof(Agent.LastSeen), DateTime.UtcNow),
        }, ct);
    }

    public async Task UpdateLastSeenAsync(string id, CancellationToken ct = default)
    {
        await _agents.UpdateByIdAsync(id,
            new[] { new FieldUpdate(nameof(Agent.LastSeen), DateTime.UtcNow) }, ct);
    }

    public async Task UpdateGeoAsync(string id, GeoInfo geo, CancellationToken ct = default)
    {
        await _agents.UpdateByIdAsync(id,
            new[] { new FieldUpdate(nameof(Agent.Geo), geo) }, ct);
    }

    public async Task<bool> SetWsNeededAsync(string id, bool needed, CancellationToken ct = default)
    {
        var agent = await _agents.GetByIdAsync(id, ct);
        if (agent == null) return false;
        await _agents.UpdateByIdAsync(id,
            new[] { new FieldUpdate(nameof(Agent.WsNeeded), needed) }, ct);
        _eventHub.Push(id, "ws", new { wsNeeded = needed });
        return true;
    }

    public async Task<bool> GetWsNeededAsync(string id, CancellationToken ct = default)
    {
        var agent = await _agents.GetByIdAsync(id, ct);
        return agent?.WsNeeded ?? false;
    }

    public async Task<long> DeleteAsync(string id, CancellationToken ct = default)
    {
        return await _agents.DeleteAsync(id, ct);
    }

    public async Task<long> CountAsync(CancellationToken ct = default)
    {
        return await _agents.CountAsync(ct: ct);
    }

    public async Task<long> CountByStatusAsync(AgentStatus status, CancellationToken ct = default)
    {
        return await _agents.CountAsync(a => a.Status == status, ct);
    }

    private static AgentListItem MapToList(Agent a) => new()
    {
        Id = a.Id,
        Hostname = a.Hostname,
        IpAddress = a.IpAddress,
        OsVersion = a.OsVersion,
        Status = a.Status,
        LastSeen = a.LastSeen,
        Geo = a.Geo
    };

    private static AgentDetail MapToDetail(Agent a) => new()
    {
        Id = a.Id,
        Hostname = a.Hostname,
        IpAddress = a.IpAddress,
        OsVersion = a.OsVersion,
        Arch = a.Arch,
        UserName = a.UserName,
        ProcessName = a.ProcessName,
        Pid = a.Pid,
        IsElevated = a.IsElevated,
        Status = a.Status,
        Hwid = a.Hwid,
        FirstSeen = a.FirstSeen,
        LastSeen = a.LastSeen,
        HeartbeatInterval = a.HeartbeatInterval,
        Hardware = a.Hardware,
        Geo = a.Geo,
        Metadata = a.Metadata
    };
}
