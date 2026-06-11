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
    private readonly ConnectionManager _wsManager;
    private readonly IHttpClientFactory _httpClientFactory;

    public OtherSoftController(ConnectionManager wsManager, IHttpClientFactory httpClientFactory)
    {
        _wsManager = wsManager;
        _httpClientFactory = httpClientFactory;
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

    [HttpGet("qqinfo/{qq}")]
    public async Task<IActionResult> GetQQInfo(string qq, CancellationToken ct)
    {
        try
        {
            var client = _httpClientFactory.CreateClient();
            var url = $"https://uapis.cn/api/v1/social/qq/userinfo?qq={qq}";
            var json = await client.GetStringAsync(url, ct);
            return Content(json, "application/json");
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { error = $"Failed to fetch QQ info: {ex.Message}" });
        }
    }
}
