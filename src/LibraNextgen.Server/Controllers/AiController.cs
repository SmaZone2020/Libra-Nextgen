using System.Security.Claims;
using System.Text.Json;
using LibraNextgen.Common.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// </summary>
[ApiController]
[Route("api/ai")]
[Authorize]
public class AiController : ControllerBase
{
    private readonly AiService _ai;
    private readonly ILogger<AiController> _logger;

    public AiController(AiService ai, ILogger<AiController> logger)
    {
        _ai = ai;
        _logger = logger;
    }

    private string UserId => User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? User.FindFirst("sub")?.Value
        ?? throw new UnauthorizedAccessException("No user identity.");
    private string UserName => User.Identity?.Name ?? "";
    private bool IsAdmin => User.IsInRole("Admin");


    [HttpGet("providers")]
    public async Task<IActionResult> GetProviders(CancellationToken ct)
        => Ok(await _ai.GetProvidersAsync(ct));

    [HttpPost("providers")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> CreateProvider([FromBody] AiProviderReq req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { error = "name is required" });
        var p = await _ai.CreateProviderAsync(ToModel(req), ct);
        return Ok(p);
    }

    [HttpPut("providers/{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> UpdateProvider(string id, [FromBody] AiProviderReq req, CancellationToken ct)
    {
        var ok = await _ai.UpdateProviderAsync(id, ToModel(req), ct);
        return ok ? Ok(new { updated = true }) : NotFound(new { error = "provider not found" });
    }

    [HttpDelete("providers/{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> DeleteProvider(string id, CancellationToken ct)
    {
        var ok = await _ai.DeleteProviderAsync(id, ct);
        return ok ? Ok(new { deleted = true }) : NotFound(new { error = "provider not found" });
    }

    [HttpPost("providers/test")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> TestProvider([FromBody] AiProviderReq req, CancellationToken ct)
    {
        var (ok, error, models) = await _ai.TestProviderAsync(ToModel(req), ct);
        return ok ? Ok(new { ok = true, models }) : Ok(new { ok = false, error });
    }


    [HttpGet("sessions")]
    public async Task<IActionResult> GetSessions(CancellationToken ct)
        => Ok(await _ai.GetSessionsAsync(UserId, ct));

    [HttpGet("sessions/{id}")]
    public async Task<IActionResult> GetSession(string id, CancellationToken ct)
    {
        var s = await _ai.GetSessionAsync(id, UserId, ct);
        return s == null ? NotFound(new { error = "session not found" }) : Ok(s);
    }

    [HttpGet("sessions/{id}/pending-approval")]
    public async Task<IActionResult> GetPendingApproval(string id, CancellationToken ct)
    {
        var pending = await _ai.GetPendingApprovalAsync(id, UserId, ct);
        return Ok(pending);
    }

    [HttpPost("sessions")]
    public async Task<IActionResult> CreateSession([FromBody] AiSessionReq req, CancellationToken ct)
    {
        var s = await _ai.CreateSessionAsync(UserId, UserName, req.ProviderId ?? "", req.Model ?? "", ct);
        return Ok(s);
    }

    [HttpDelete("sessions/{id}")]
    public async Task<IActionResult> DeleteSession(string id, CancellationToken ct)
    {
        var ok = await _ai.DeleteSessionAsync(id, UserId, ct);
        return ok ? Ok(new { deleted = true }) : NotFound(new { error = "session not found" });
    }

    [HttpPut("sessions/{id}/rename")]
    public async Task<IActionResult> RenameSession(string id, [FromBody] AiRenameReq req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Title))
            return BadRequest(new { error = "title is required" });
        var ok = await _ai.RenameSessionAsync(id, UserId, req.Title.Trim(), ct);
        return ok ? Ok(new { renamed = true }) : NotFound(new { error = "session not found" });
    }

    [HttpPut("sessions/{id}/messages/{messageId}")]
    public async Task<IActionResult> EditMessage(string id, string messageId, [FromBody] AiEditMessageReq req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Content))
            return BadRequest(new { error = "content is required" });
        var ok = await _ai.EditMessageAsync(id, UserId, messageId, req.Content, ct);
        return ok ? Ok(new { edited = true }) : BadRequest(new { error = "message not found or not editable" });
    }

    [HttpDelete("sessions/{id}/messages/{messageId}")]
    public async Task<IActionResult> DeleteMessage(string id, string messageId, CancellationToken ct)
    {
        var ok = await _ai.DeleteMessageAsync(id, UserId, messageId, ct);
        return ok ? Ok(new { deleted = true }) : NotFound(new { error = "message not found" });
    }

    [HttpDelete("sessions/{id}/messages/{messageId}/after")]
    public async Task<IActionResult> TruncateMessagesAfter(string id, string messageId, CancellationToken ct)
    {
        var ok = await _ai.TruncateMessagesAfterAsync(id, UserId, messageId, ct);
        return ok ? Ok(new { truncated = true }) : NotFound(new { error = "message not found" });
    }

    [HttpPost("sessions/{id}/fork")]
    public async Task<IActionResult> ForkSession(string id, CancellationToken ct)
    {
        var fork = await _ai.ForkSessionAsync(id, UserId, UserName, ct);
        return fork == null ? NotFound(new { error = "session not found" }) : Ok(fork);
    }


    [HttpGet("mcp")]
    public async Task<IActionResult> GetMcp(CancellationToken ct)
    {
        // Tool allowlisting removed: every registered MCP tool is open to the AI
        // (gated by Justitia tiers/approval). Endpoint kept for compatibility.
        return Ok(new
        {
            toolsEnabled = true,
            allowedTools = Array.Empty<string>(),
            tools = await _ai.GetToolsAsync(ct),
        });
    }

    [HttpPut("mcp")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> SetMcp([FromBody] AiMcpReq req, CancellationToken ct)
    {
        await _ai.SetMcpConfigAsync(new AiMcpConfig
        {
            ToolsEnabled = req.ToolsEnabled,
            AllowedTools = req.AllowedTools ?? new List<string>(),
        }, ct);
        return Ok(new { saved = true });
    }


    /// <summary>
    ///   reasoning {label,content} | message {delta} | tool_call {toolCall} |
    ///   tool_result {toolCallId,toolName,output,state} | approval {toolCall} |
    ///   done {sessionId,messageId} | error {message}
    /// </summary>
    [HttpPost("chat")]
    public async Task Chat([FromBody] AiChatReq req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Content))
        {
            Response.StatusCode = 400;
            await Response.WriteAsync("{\"error\":\"content is required\"}", ct);
            return;
        }

        var session = await _ai.GetSessionAsync(req.SessionId ?? "", UserId, ct);
        if (session == null)
        {
            Response.StatusCode = 404;
            await Response.WriteAsync("{\"error\":\"session not found\"}", ct);
            return;
        }

        Response.Headers.CacheControl = "no-cache";
        Response.Headers.ContentType = "text/event-stream";
        HttpContext.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpResponseBodyFeature>()?.DisableBuffering();
        await Response.Body.FlushAsync(ct);

        async Task Send(string payload)
        {
            await Response.WriteAsync($"data: {payload}\n\n", ct);
            await Response.Body.FlushAsync(ct);
        }

        await _ai.RunChatAsync(session, req.Content, Send, ct, JustitiaPolicy.Parse(req.Tier));
    }

    /// <summary>
    /// </summary>
    [HttpPost("chat/action")]
    public async Task<IActionResult> ChatAction([FromBody] AiChatActionReq req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.SessionId) || string.IsNullOrWhiteSpace(req.ToolCallId))
            return BadRequest(new { error = "sessionId and toolCallId are required" });

        var session = await _ai.GetSessionAsync(req.SessionId, UserId, ct);
        if (session == null) return NotFound(new { error = "session not found" });

        var accepted = await _ai.ResolveApprovalAsync(req.SessionId, req.ToolCallId, req.Approved, ct, req.Permit);
        return accepted
            ? Ok(new { accepted = true })
            : NotFound(new { error = "no pending approval for this tool call" });
    }

    [HttpPost("chat/stop")]
    public IActionResult Stop([FromBody] AiStopReq req)
    {
        _ai.StopRun(req.SessionId ?? "");
        return Ok(new { stopped = true });
    }


    private static AiProvider ToModel(AiProviderReq req) => new()
    {
        Name = req.Name ?? "",
        ProviderType = req.ProviderType ?? "openai-compatible",
        BaseUrl = req.BaseUrl ?? "",
        ApiKeyEnc = req.ApiKey ?? "",
        Models = req.Models ?? new List<string>(),
        DefaultModel = req.DefaultModel ?? "",
        Enabled = req.Enabled,
        RequireApproval = req.RequireApproval,
    };
}

public class AiProviderReq
{
    public string? Name { get; set; }
    public string? ProviderType { get; set; }
    public string? BaseUrl { get; set; }
    public string? ApiKey { get; set; }
    public List<string>? Models { get; set; }
    public string? DefaultModel { get; set; }
    public bool Enabled { get; set; } = true;
    public bool RequireApproval { get; set; } = true;
}

public class AiSessionReq
{
    public string? ProviderId { get; set; }
    public string? Model { get; set; }
}

public class AiRenameReq
{
    public string? Title { get; set; }
}

public class AiEditMessageReq
{
    public string? Content { get; set; }
}

public class AiMcpReq
{
    public bool ToolsEnabled { get; set; } = true;
    public List<string>? AllowedTools { get; set; }
}

public class AiChatReq
{
    public string? SessionId { get; set; }
    public string? Content { get; set; }
    public string? Tier { get; set; }
}

public class AiChatActionReq
{
    public string? SessionId { get; set; }
    public string? ToolCallId { get; set; }
    public bool Approved { get; set; }
    public string Permit { get; set; } = "one-time";
}

public class AiStopReq
{
    public string? SessionId { get; set; }
}
