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

    public AgentsController(AgentService agentService)
    {
        _agentService = agentService;
    }

    /// <summary>
    /// List all agents with optional pagination.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        var agents = await _agentService.GetAllAsync(page, pageSize, ct);
        var total = await _agentService.CountAsync(ct);
        var online = await _agentService.CountByStatusAsync(AgentStatus.Online, ct);
        return Ok(new { agents, total, online, page, pageSize });
    }

    /// <summary>
    /// Get agent details by ID.
    /// </summary>
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id, CancellationToken ct)
    {
        var agent = await _agentService.GetByIdAsync(id, ct);
        if (agent == null) return NotFound();
        return Ok(agent);
    }

    /// <summary>
    /// Remove a stale/offline agent.
    /// </summary>
    [HttpDelete("{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var deleted = await _agentService.DeleteAsync(id, ct);
        if (deleted == 0) return NotFound();
        return NoContent();
    }
}
