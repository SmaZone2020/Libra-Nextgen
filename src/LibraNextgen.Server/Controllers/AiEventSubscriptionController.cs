using System.Security.Claims;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// </summary>
[ApiController]
[Route("api/ai/event-subscriptions")]
[Authorize(Roles = "Admin")]
public class AiEventSubscriptionController : ControllerBase
{
    private static readonly string[] ValidEvents =
        { AiEventNotifier.EvtAgentOnline, AiEventNotifier.EvtAgentOffline };

    private readonly IStore<AiEventSubscription> _subs;
    private readonly AiService _ai;
    private readonly AiChannelService _channels;

    public AiEventSubscriptionController(IStore<AiEventSubscription> subs, AiService ai, AiChannelService channels)
    {
        _subs = subs;
        _ai = ai;
        _channels = channels;
    }

    private string UserId => User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? User.FindFirst("sub")?.Value
        ?? "";
    private string UserName => User.FindFirst(ClaimTypes.Name)?.Value ?? "";

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var all = await _subs.GetAllAsync(ct);
        return Ok(all.OrderByDescending(s => s.CreatedAt).ToList());
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] AiEventSubscriptionReq req, CancellationToken ct)
    {
        var events = (req.Events ?? new List<string>())
            .Select(e => e.Trim()).Where(e => e.Length > 0).Distinct().ToList();
        if (events.Count == 0 || events.Any(e => !ValidEvents.Contains(e)))
            return BadRequest(new { error = $"events must be a non-empty subset of [{string.Join(", ", ValidEvents)}]" });

        if (req.TargetType != "session" && req.TargetType != "channel")
            return BadRequest(new { error = "targetType must be 'session' or 'channel'" });

        if (string.IsNullOrWhiteSpace(req.TargetId))
            return BadRequest(new { error = "targetId is required" });

        if (req.TargetType == "session")
        {
            var session = await _ai.GetSessionAsync(req.TargetId.Trim(), req.TargetUserId ?? UserId, ct);
            if (session == null) return NotFound(new { error = "session not found" });
        }
        else
        {
            var ch = await _channels.GetChannelAsync(req.TargetId.Trim(), includeSecrets: false, ct);
            if (ch == null) return NotFound(new { error = "channel not found" });
            if (!ch.Enabled) return BadRequest(new { error = "channel is disabled" });
        }

        var sub = new AiEventSubscription
        {
            Events = events,
            TargetType = req.TargetType,
            TargetId = req.TargetId.Trim(),
            TargetUserId = req.TargetType == "session" ? (req.TargetUserId ?? UserId) : null,
            CreatedBy = UserId,
            CreatedByName = UserName,
        };
        await _subs.InsertAsync(sub, ct);
        return Ok(sub);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var deleted = await _subs.DeleteAsync(id, ct);
        return deleted > 0 ? Ok(new { deleted = true }) : NotFound(new { error = "subscription not found" });
    }
}

public class AiEventSubscriptionReq
{
    public List<string>? Events { get; set; }
    public string? TargetType { get; set; }
    public string? TargetId { get; set; }
    public string? TargetUserId { get; set; }
}
