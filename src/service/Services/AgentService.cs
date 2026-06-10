using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

public class AgentService
{
    private readonly Repository<Agent> _agents;

    public AgentService(Repository<Agent> agents)
    {
        _agents = agents;
    }

    public async Task<List<AgentListItem>> GetAllAsync(int page = 1, int pageSize = 50, AgentStatus? status = null, CancellationToken ct = default)
    {
        var filter = status.HasValue
            ? Builders<Agent>.Filter.Eq(a => a.Status, status.Value)
            : Builders<Agent>.Filter.Where(a => true);
        var sort = Builders<Agent>.Sort.Descending(a => a.FirstSeen);
        var agents = await _agents.FindPagedAsync(filter, page, pageSize, sort, ct);
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
        var update = Builders<Agent>.Update
            .Set(a => a.Status, status)
            .Set(a => a.LastSeen, DateTime.UtcNow);
        await _agents.UpdateAsync(id, update, ct);
    }

    public async Task UpdateLastSeenAsync(string id, CancellationToken ct = default)
    {
        var update = Builders<Agent>.Update.Set(a => a.LastSeen, DateTime.UtcNow);
        await _agents.UpdateAsync(id, update, ct);
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
        LastSeen = a.LastSeen
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
        Metadata = a.Metadata
    };
}
