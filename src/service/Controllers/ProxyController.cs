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
    private readonly RelayService _relay;

    public ProxyController(RelayService relay)
    {
        _relay = relay;
    }

    private async Task<IActionResult> RelayAndWaitAsync(string agentId, string messageType, object? data, CancellationToken ct)
    {
        var response = await _relay.RelayAndWaitAsync(agentId, messageType, data, ct);
        if (response == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });
        return response.Data != null
            ? Content(response.Data.Value.GetRawText(), "application/json")
            : Ok(new { status = "ok" });
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
