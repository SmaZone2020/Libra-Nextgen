using LibraNextgen.Service.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// Reports which store the service is actually running on. The console reads
/// this to render the storage switcher (docs/desktop-electron-architecture.md §3).
/// </summary>
[ApiController]
[Route("api/system")]
[Authorize]
public class SystemStorageController : ControllerBase
{
    private readonly StoreResolution _resolution;

    public SystemStorageController(StoreResolution resolution)
    {
        _resolution = resolution;
    }

    [HttpGet("storage")]
    public IActionResult Storage()
    {
        var requested = _resolution.Requested.ToString().ToLowerInvariant();
        var effective = _resolution.Effective.ToString().ToLowerInvariant();
        return Ok(new
        {
            requested,
            effective,
            fallbackReason = _resolution.FallbackReason,
            dbType = effective,
            message = requested == effective
                ? null
                : "MongoDB was unreachable at startup; running on the local SQLite store. Data is not migrated between stores.",
        });
    }
}
