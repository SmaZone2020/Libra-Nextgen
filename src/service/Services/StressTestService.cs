using System.Collections.Concurrent;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services;

public class StressTestService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ConcurrentDictionary<string, StressTestCampaign> _campaigns = new();
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, StressAgentStatus>> _agentStatuses = new();

    public StressTestService(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
    }

    public async Task<StressTestCampaign> CreateAsync(StressStartRequest req, string username)
    {
        var campaign = new StressTestCampaign
        {
            Name = req.Name,
            TargetHost = req.TargetHost,
            TargetPort = req.TargetPort,
            Methods = req.Methods,
            AgentIds = req.AgentIds,
            DurationSeconds = req.DurationSeconds,
            ContinueAfterClose = req.ContinueAfterClose,
            ThreadsPerAgent = req.ThreadsPerAgent,
            PacketSize = req.PacketSize,
            CreatedBy = username,
            Status = CampaignStatus.Running
        };

        _campaigns[campaign.Id] = campaign;
        _agentStatuses[campaign.Id] = new ConcurrentDictionary<string, StressAgentStatus>();

        // Persist to MongoDB
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var repo = scope.ServiceProvider.GetRequiredService<Repository<StressTestCampaign>>();
            await repo.InsertAsync(campaign);
        }
        catch { /* best-effort persistence */ }

        return campaign;
    }

    public StressTestCampaign? GetById(string id)
    {
        _campaigns.TryGetValue(id, out var c);
        return c;
    }

    public List<StressTestCampaign> GetHistory(int page = 1, int pageSize = 20)
    {
        return _campaigns.Values
            .OrderByDescending(c => c.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();
    }

    public void UpdateStatus(string id, CampaignStatus status)
    {
        if (_campaigns.TryGetValue(id, out var c))
            c.Status = status;
    }

    public void UpdateAgentStatus(string campaignId, StressAgentStatus status)
    {
        if (_agentStatuses.TryGetValue(campaignId, out var dict))
            dict[status.AgentId] = status;
    }

    public List<StressAgentStatus> GetAgentStatuses(string campaignId)
    {
        if (_agentStatuses.TryGetValue(campaignId, out var dict))
            return dict.Values.ToList();
        return new();
    }
}
