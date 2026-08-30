using System.Security.Claims;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// AI 频道（IM 接入）管理 API：
/// 频道 CRUD / 测试连接（Admin）；一次性绑定码 / 绑定用户管理（Admin）；
/// 绑定用户查询自己的频道会话（登录用户）。
/// </summary>
[ApiController]
[Route("api/ai/channels")]
[Authorize]
public class AiChannelController : ControllerBase
{
    private readonly AiChannelService _channels;

    public AiChannelController(AiChannelService channels)
    {
        _channels = channels;
    }

    private string UserId => User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? User.FindFirst("sub")?.Value
        ?? throw new UnauthorizedAccessException("No user identity.");

    // ── 频道 CRUD（Admin）───────────────────────────────────────────────

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

    /// <summary>测试连接（新建草稿，无频道 id；哨兵密钥自动用已存配置补齐）。</summary>
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

    /// <summary>测试连接（编辑态，按已有频道 id 补齐哨兵密钥）。</summary>
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

    // ── 绑定码 / 绑定用户（Admin）─────────────────────────────────────────

    /// <summary>为指定控制台账号生成一次性绑定码（15 分钟有效，返回后仅在本次响应中可见）。</summary>
    [HttpPost("{id}/bind-codes")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> CreateBindCode(string id, [FromBody] AiBindCodeReq req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.UserId))
            return BadRequest(new { error = "userId is required" });
        try
        {
            var (code, expiresAt) = await _channels.CreateBindCodeAsync(id, req.UserId.Trim(), ct);
            return Ok(new { code, expiresAt });
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

    /// <summary>调整绑定用户的档位覆盖（body.tier 为 null 时清除覆盖，回落频道默认档位）。</summary>
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

    // ── 用户侧 ───────────────────────────────────────────────────────────

    /// <summary>绑定用户自己的频道会话（控制台 AI 页"频道会话"分区）。</summary>
    [HttpGet("sessions")]
    public async Task<IActionResult> MyChannelSessions(CancellationToken ct)
        => Ok(await _channels.MyChannelSessionsAsync(UserId, ct));

    // ── 请求模型 ─────────────────────────────────────────────────────────

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

/// <summary>新建草稿测试连接：可带已有频道 id 以复用已存密钥。</summary>
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
    /// <summary>0-3；null = 清除覆盖，回落频道默认档位。</summary>
    public int? Tier { get; set; }
}
