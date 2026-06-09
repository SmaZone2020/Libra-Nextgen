using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// Public endpoints for agent beacon communication.
/// These endpoints are NOT protected by JWT — agents use AES/RSA encryption instead.
/// </summary>
[ApiController]
[Route("api/beacon")]
public class AgentCommsController : ControllerBase
{
    private readonly AgentCommsService _commsService;

    public AgentCommsController(AgentCommsService commsService)
    {
        _commsService = commsService;
    }

    /// <summary>
    /// Agent registration. Agent sends system info and RSA public key.
    /// Server responds with a session AES key encrypted with the agent's RSA public key.
    /// </summary>
    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Hostname))
            return BadRequest(new { error = "hostname required" });

        var clientIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var agent = await _commsService.HandleRegisterAsync(request, clientIp);

        if (agent == null)
            return StatusCode(500, new { error = "registration failed" });

        var profile = _commsService.GetActiveProfile();
        var response = new
        {
            agent_id = agent.Id,
            heartbeat_url = profile.GetHeartbeatUrl("/api/beacon"),
            result_url = profile.GetResultUrl("/api/beacon"),
            ws_url = profile.GetWebSocketUrl(""),
            heartbeat_interval = profile.HeartbeatIntervalSeconds,
            jitter = profile.JitterPercent
        };

        return Ok(response);
    }

    /// <summary>
    /// Heartbeat endpoint. Agent polls this to check for pending tasks.
    /// Body is encrypted with the session AES key.
    /// </summary>
    [HttpPost("heartbeat")]
    public async Task<IActionResult> Heartbeat([FromBody] object encryptedPayload)
    {
        // In production: decrypt payload using agent's session key
        // For now, extract agent_id from the envelope
        var agentId = Request.Headers["X-Agent-Id"].FirstOrDefault();
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        var (valid, task) = await _commsService.HandleHeartbeatAsync(agentId, Array.Empty<byte>());
        if (!valid)
            return NotFound(new { error = "agent not found" });

        var response = new HeartbeatResponse { PendingTask = task };
        return Ok(response);
    }

    /// <summary>
    /// Task result submission. Agent posts encrypted execution results.
    /// </summary>
    [HttpPost("result")]
    public async Task<IActionResult> SubmitResult([FromBody] TaskResult result)
    {
        var agentId = Request.Headers["X-Agent-Id"].FirstOrDefault();
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        var success = await _commsService.HandleResultAsync(agentId, result, Array.Empty<byte>());
        if (!success)
            return NotFound(new { error = "invalid task" });

        return Ok(new { status = "received" });
    }
}
