using System.Security.Claims;
using LibraNextgen.Common.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// </summary>
[ApiController]
[Route("api/ai/channels")]
[Authorize]
public class AiChannelController : ControllerBase
{
    private readonly AiChannelService _channels;
    private readonly WeChatClawAdapter _claw;

    public AiChannelController(AiChannelService channels, WeChatClawAdapter claw)
    {
        _channels = channels;
        _claw = claw;
    }

    private string UserId => User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? User.FindFirst("sub")?.Value
        ?? throw new UnauthorizedAccessException("No user identity.");


    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await _channels.ListChannelsAsync(includeSecrets: false, ct));

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] AiChannelReq req, CancellationToken ct)
    {
        try
        {
            return Ok(await _channels.CreateChannelAsync(ToModel(req), ct));
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPut("{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(string id, [FromBody] AiChannelReq req, CancellationToken ct)
    {
        try
        {
            var ok = await _channels.UpdateChannelAsync(id, ToModel(req), ct);
            return ok ? Ok(new { updated = true }) : NotFound(new { error = "channel not found" });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var ok = await _channels.DeleteChannelAsync(id, ct);
        return ok ? Ok(new { deleted = true }) : NotFound(new { error = "channel not found" });
    }

    [HttpPost("test")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Test([FromBody] AiChannelTestReq req, CancellationToken ct)
    {
        var stored = !string.IsNullOrEmpty(req.Id)
            ? await _channels.GetChannelAsync(req.Id, includeSecrets: true, ct)
            : null;
        var input = ToModel(req);
        foreach (var key in AiChannelTypes.SensitiveKeys)
        {
            if (input.Config.TryGetValue(key, out var v) && (v == "********" || v.Length == 0))
                input.Config[key] = stored?.Config.GetValueOrDefault(key, "") ?? "";
        }
        var (ok, error) = await _channels.TestChannelAsync(input, ct);
        return ok ? Ok(new { ok = true }) : Ok(new { ok = false, error });
    }

    [HttpPost("{id}/test")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> TestById(string id, [FromBody] AiChannelReq req, CancellationToken ct)
    {
        var stored = await _channels.GetChannelAsync(id, includeSecrets: true, ct);
        var input = ToModel(req);
        foreach (var key in AiChannelTypes.SensitiveKeys)
        {
            if (input.Config.TryGetValue(key, out var v) && (v == "********" || v.Length == 0))
                input.Config[key] = stored?.Config.GetValueOrDefault(key, "") ?? "";
        }
        var (ok, error) = await _channels.TestChannelAsync(input, ct);
        return ok ? Ok(new { ok = true }) : Ok(new { ok = false, error });
    }

    [HttpPost("{id}/token")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> SetToken(string id, [FromBody] AiChannelTokenReq req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Token))
            return BadRequest(new { error = "token is required" });
        var ok = await _channels.SetChannelTokenAsync(id, req.Token.Trim(), req.BaseUrl, req.ILinkBotId, ct);
        return ok ? Ok(new { saved = true }) : NotFound(new { error = "channel not found" });
    }

    [HttpPost("{id}/wechat/qrcode")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> WeChatQrCode(string id, CancellationToken ct)
    {
        var ch = await _channels.GetChannelAsync(id, includeSecrets: true, ct);
        if (ch == null) return NotFound(new { error = "channel not found" });
        if (ch.ChannelType != AiChannelTypes.WechatClaw)
            return BadRequest(new { error = "channel is not wechat-claw" });
        try
        {
            var (qrcode, imageUrl) = await _claw.CreateQrCodeAsync(ch, ct);
            return Ok(new { qrcode, imageUrl });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("{id}/wechat/qrcode/status")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> WeChatQrStatus(string id, [FromBody] AiChannelQrStatusReq req, CancellationToken ct)
    {
        var ch = await _channels.GetChannelAsync(id, includeSecrets: true, ct);
        if (ch == null) return NotFound(new { error = "channel not found" });
        if (ch.ChannelType != AiChannelTypes.WechatClaw)
            return BadRequest(new { error = "channel is not wechat-claw" });
        if (string.IsNullOrWhiteSpace(req.Qrcode))
            return BadRequest(new { error = "qrcode is required" });
        try
        {
            var result = await _claw.GetQrCodeStatusAsync(ch, req.Qrcode.Trim(), ct);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// </summary>
    [HttpPost("wechat/qrcode")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> WeChatQrCodeDraft(CancellationToken ct)
    {
        try
        {
            var (qrcode, imageUrl) = await _claw.CreateQrCodeAsync(ct);
            return Ok(new { qrcode, imageUrl });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("wechat/qrcode/status")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> WeChatQrStatusDraft([FromBody] AiChannelQrStatusReq req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Qrcode))
            return BadRequest(new { error = "qrcode is required" });
        try
        {
            var result = await _claw.GetQrCodeStatusAsync(req.Qrcode.Trim(), ct);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }


    [HttpPost("{id}/bind-codes")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> CreateBindCode(string id, [FromBody] AiBindCodeReq req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.UserId))
            return BadRequest(new { error = "userId is required" });
        try
        {
            var (code, expiresAt, bindUrl) = await _channels.CreateBindCodeAsync(id, req.UserId.Trim(), ct);
            return Ok(new { code, expiresAt, bindUrl });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
    }

    [HttpGet("{id}/users")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> ListUsers(string id, CancellationToken ct)
        => Ok(await _channels.ListUsersAsync(id, ct));

    [HttpGet("{id}/bind-codes")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> ListBindCodes(string id, CancellationToken ct)
        => Ok(await _channels.ListBindCodesAsync(id, ct));

    [HttpDelete("{id}/bind-codes/{codeId}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> RevokeBindCode(string id, string codeId, CancellationToken ct)
    {
        var ok = await _channels.RevokeBindCodeAsync(id, codeId, ct);
        return ok ? Ok(new { revoked = true }) : BadRequest(new { error = "绑定码不存在、已使用或已作废" });
    }

    [HttpPut("users/{channelUserId}/tier")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> SetUserTier(string channelUserId, [FromBody] AiUserTierReq req, CancellationToken ct)
    {
        try
        {
            var ok = await _channels.SetUserTierAsync(channelUserId, req.Tier, ct);
            return ok ? Ok(new { saved = true }) : NotFound(new { error = "user binding not found" });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("users/{channelUserId}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Unbind(string channelUserId, CancellationToken ct)
    {
        var ok = await _channels.UnbindUserAsync(channelUserId, ct);
        return ok ? Ok(new { deleted = true }) : NotFound(new { error = "user binding not found" });
    }


    [HttpGet("sessions")]
    public async Task<IActionResult> MyChannelSessions(CancellationToken ct)
        => Ok(await _channels.MyChannelSessionsAsync(UserId, ct));


    private static AiChannel ToModel(AiChannelReq req) => new()
    {
        Name = req.Name ?? "",
        ChannelType = req.ChannelType ?? AiChannelTypes.Telegram,
        Enabled = req.Enabled,
        Config = req.Config ?? new Dictionary<string, string>(),
        DefaultTier = req.DefaultTier ?? 0,
        RequireBind = req.RequireBind,
        DefaultProviderId = req.DefaultProviderId ?? "",
        DefaultModel = req.DefaultModel ?? "",
        ShowToolCalls = req.ShowToolCalls,
        StreamOutput = req.StreamOutput,
        AllowInGroups = req.AllowInGroups,
    };
}

public class AiChannelReq
{
    public string? Name { get; set; }
    public string? ChannelType { get; set; }
    public bool Enabled { get; set; } = true;
    public Dictionary<string, string>? Config { get; set; }
    public int? DefaultTier { get; set; }
    public bool RequireBind { get; set; } = true;
    public string? DefaultProviderId { get; set; }
    public string? DefaultModel { get; set; }
    public bool ShowToolCalls { get; set; } = true;
    public bool StreamOutput { get; set; }
    public bool AllowInGroups { get; set; }
}

public class AiChannelTokenReq
{
    public string? Token { get; set; }
    public string? BaseUrl { get; set; }
    public string? ILinkBotId { get; set; }
}

public class AiChannelQrStatusReq
{
    public string? Qrcode { get; set; }
}

public class AiChannelTestReq : AiChannelReq
{
    public string? Id { get; set; }
}

public class AiBindCodeReq
{
    public string? UserId { get; set; }
}

public class AiUserTierReq
{
    public int? Tier { get; set; }
}
