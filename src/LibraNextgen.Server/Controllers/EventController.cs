using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// Global event feed (agent lifecycle / tasks / operators / shell sessions),
/// soft-filtered per user via the clear watermark.
/// </summary>
[ApiController]
[Route("api/events")]
[Authorize]
public class EventController : ControllerBase
{
    private readonly ConnectionManager _wsManager;

    public EventController(ConnectionManager wsManager)
    {
        _wsManager = wsManager;
    }

    private string UserName => User.Identity?.Name
        ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "";

    [HttpGet]
    public IActionResult Recent([FromQuery] int limit = 50)
    {
        var watermark = _wsManager.GetClearedBeforeUtc(UserName);
        var events = _wsManager.GetRecentEvents(Math.Clamp(limit, 1, 200));
        if (watermark is { } clearedAt)
        {
            events = events.Where(e => e.Ts > clearedAt).ToList();
        }
        return Ok(new { events });
    }

    /// <summary>
    /// Soft-clear: hides the current user's past events from their own feeds.
    /// Audit logs (append-only) and other users' feeds are not touched.
    /// </summary>
    [HttpPost("clear")]
    public IActionResult Clear()
    {
        if (string.IsNullOrEmpty(UserName)) return Unauthorized();
        _wsManager.ClearEventsForUser(UserName);
        return Ok(new { status = "ok" });
    }
}
