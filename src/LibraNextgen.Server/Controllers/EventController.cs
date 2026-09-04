using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

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

    [HttpGet]
    public IActionResult Recent([FromQuery] int limit = 50)
    {
        var events = _wsManager.GetRecentEvents(Math.Clamp(limit, 1, 200));
        return Ok(new { events });
    }
}
