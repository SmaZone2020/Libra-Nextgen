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
    private readonly ConnectionManager _wsManager;
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(8) };

    public OtherSoftController(ConnectionManager wsManager)
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
