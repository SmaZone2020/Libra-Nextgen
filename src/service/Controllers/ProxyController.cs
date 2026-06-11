using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/proxy")]
[Authorize]
public class ProxyController : ControllerBase
{
    private readonly ConnectionManager _wsManager;

    public ProxyController(ConnectionManager wsManager)
    {
        _wsManager = wsManager;
    }

    private async Task<IActionResult> RelayAndWaitAsync(string agentId, string messageType, object? data, CancellationToken ct)
    {
        var requestId = Guid.NewGuid().ToString("N");

        var msg = new WebSocketMessage
        {
            Type = messageType,
            Channel = agentId,
            Data = data != null ? JsonSerializer.SerializeToElement(data) : null,
            RequestId = requestId
        };

        var tcs = _wsManager.RegisterPendingRequest(requestId);
        await _wsManager.RelayToAgentAsync(agentId, msg, ct);

        try
        {
            var response = await tcs.Task.WaitAsync(TimeSpan.FromSeconds(30), ct);
            return response.Data != null
                ? Content(response.Data.Value.GetRawText(), "application/json")
                : Ok(new { status = "ok" });
        }
        catch (TimeoutException)
        {
            return StatusCode(504, new { error = "Agent did not respond in time." });
        }
    }

    [HttpPost("{agentId}/fetch")]
    public async Task<IActionResult> Fetch(string agentId, [FromBody] ProxyFetchRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "proxy.fetch", new
        {
            url = req.Url,
            method = req.Method ?? "GET",
            headers = req.Headers,
            body = req.Body
        }, ct);
    }

    [HttpGet("{agentId}/resource")]
    public async Task<IActionResult> Resource(
        string agentId,
        [FromQuery] string url,
        [FromQuery] string? method = null,
        [FromQuery] string? body = null,
        [FromQuery] string? headers = null,
        CancellationToken ct = default)
    {
        var result = await RelayAndWaitAsync(agentId, "proxy.fetch", new
        {
            url,
            method = method ?? "GET",
            headers,
            body
        }, ct);

        if (result is ContentResult content)
        {
            var doc = JsonDocument.Parse(content.Content!);
            if (doc.RootElement.TryGetProperty("error", out var errProp))
                return BadRequest(new { error = errProp.GetString() });

            var bodyBase64 = doc.RootElement.GetProperty("body").GetString();
            if (string.IsNullOrEmpty(bodyBase64))
                return StatusCode(doc.RootElement.GetProperty("status").GetInt32());

            var contentType = "application/octet-stream";
            try { contentType = doc.RootElement.GetProperty("contentType").GetString() ?? contentType; } catch { }

            return File(Convert.FromBase64String(bodyBase64), contentType);
        }

        return result;
    }
}

public record ProxyFetchRequest(string Url, string? Method, string? Headers, string? Body);
