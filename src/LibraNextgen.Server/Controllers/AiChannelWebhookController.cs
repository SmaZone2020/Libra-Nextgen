using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// </summary>
[ApiController]
[Route("api/ai/channels/webhook")]
[AllowAnonymous]
public class AiChannelWebhookController : ControllerBase
{
    private readonly AiChannelService _channels;
    private readonly LarkChannelAdapter _lark;
    private readonly ILogger<AiChannelWebhookController> _logger;

    public AiChannelWebhookController(
        AiChannelService channels,
        LarkChannelAdapter lark,
        ILogger<AiChannelWebhookController> logger)
    {
        _channels = channels;
        _lark = lark;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/ai/channels/webhook/{id}
    /// </summary>
    [HttpPost("{id}")]
    public async Task<IActionResult> Post(string id, CancellationToken ct)
    {
        var ch = await _channels.GetChannelAsync(id, includeSecrets: true, ct);
        if (ch == null || !ch.Enabled)
            return NotFound();
        if (ch.ChannelType != AiChannelTypes.Lark)
            return NotFound();

        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        var rawBody = await reader.ReadToEndAsync(ct);
        if (rawBody.Length == 0) return BadRequest();

        try
        {
            if (rawBody.Contains("\"challenge\"", StringComparison.Ordinal) &&
                !rawBody.Contains("header", StringComparison.OrdinalIgnoreCase))
            {
                var challenge = JsonNode.Parse(rawBody)?["challenge"]?.GetValue<string>();
                return challenge != null
                    ? Content($"{{\"challenge\":\"{challenge}\"}}", "application/json")
                    : BadRequest();
            }
            var msg = await _lark.ParseWebhookAsync(
                ch, rawBody,
                Request.Headers["X-Lark-Request-Timestamp"].FirstOrDefault(),
                Request.Headers["X-Lark-Request-Nonce"].FirstOrDefault(),
                Request.Headers["X-Lark-Signature"].FirstOrDefault(),
                ct);
            if (msg != null) await _channels.HandleInboundAsync(msg, ct);
            return Ok(new { ok = true });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Channel webhook failed ({Channel} {Type})", id, ch.ChannelType);
            return BadRequest(new { error = ex.Message });
        }
    }
}
