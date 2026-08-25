using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// Global event feed (agent lifecycle / tasks / operators / shell sessions).
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

    /// <summary>最近的事件历史（Event Viewer 挂载时主动拉取，弥补 WS 回放时序丢失）。</summary>
    [HttpGet]
    public IActionResult Recent([FromQuery] int limit = 50)
    {
        var events = _wsManager.GetRecentEvents(Math.Clamp(limit, 1, 200));
        return Ok(new { events });
    }
}
