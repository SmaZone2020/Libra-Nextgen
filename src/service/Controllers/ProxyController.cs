using System.Text;
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

    // Reverse proxy: /api/proxy/{agentId}/{token}/p/{scheme}/{host}/{**path}
    // The iframe loads pages from here, so relative URLs resolve through this same path.
    [HttpGet("/api/proxy/{agentId}/{token}/p/{scheme}/{host}/{**path}")]
    [HttpPost("/api/proxy/{agentId}/{token}/p/{scheme}/{host}/{**path}")]
    public async Task<IActionResult> Proxy(
        string agentId,
        string token,
        string scheme,
        string host,
        string? path,
        CancellationToken ct)
    {
        var targetPath = string.IsNullOrEmpty(path) ? "/" : "/" + path;
        var targetUrl = $"{scheme}://{host}{targetPath}";
        if (Request.QueryString.HasValue) targetUrl += Request.QueryString.Value;

        var headers = new Dictionary<string, string>();
        foreach (var name in new[] { "Accept", "Accept-Language", "Content-Type", "User-Agent" })
        {
            if (Request.Headers.TryGetValue(name, out var v))
                headers[name] = v.ToString();
        }

        string? bodyB64 = null;
        if (!HttpMethods.IsGet(Request.Method) && !HttpMethods.IsHead(Request.Method) && Request.Body != null)
        {
            using var ms = new MemoryStream();
            await Request.Body.CopyToAsync(ms, ct);
            if (ms.Length > 0) bodyB64 = Convert.ToBase64String(ms.ToArray());
        }

        var response = await _relay.RelayAndWaitAsync(agentId, "proxy.fetch", new
        {
            url = targetUrl,
            method = Request.Method,
            headers = JsonSerializer.Serialize(headers),
            body = bodyB64
        }, ct);

        if (response == null) return StatusCode(504, new { error = "Agent did not respond in time." });
        if (response.Data == null) return Ok(new { status = "ok" });

        var data = response.Data.Value;
        if (data.TryGetProperty("error", out var errProp))
            return StatusCode(502, errProp.GetString());

        var status = data.GetProperty("status").GetInt32();
        var contentType = data.TryGetProperty("contentType", out var ctProp) ? ctProp.GetString() ?? "application/octet-stream" : "application/octet-stream";
        var bodyStr = data.GetProperty("body").GetString() ?? string.Empty;
        var finalUrl = data.TryGetProperty("url", out var urlProp) ? urlProp.GetString() ?? targetUrl : targetUrl;
        var bodyBytes = Convert.FromBase64String(bodyStr);

        if (contentType.StartsWith("text/html", StringComparison.OrdinalIgnoreCase))
        {
            var text = Encoding.UTF8.GetString(bodyBytes);
            var rewritten = ProxyRewriter.RewriteHtml(text, finalUrl, agentId, token);
            return Content(rewritten, "text/html", Encoding.UTF8);
        }

        if (contentType.StartsWith("text/css", StringComparison.OrdinalIgnoreCase))
        {
            var text = Encoding.UTF8.GetString(bodyBytes);
            var rewritten = ProxyRewriter.RewriteCss(text, finalUrl, agentId, token);
            return Content(rewritten, "text/css", Encoding.UTF8);
        }

        return File(bodyBytes, contentType);
    }
}

public record ProxyFetchRequest(string Url, string? Method, string? Headers, string? Body);
