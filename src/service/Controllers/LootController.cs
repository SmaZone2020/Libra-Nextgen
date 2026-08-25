using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// Loot library: screenshots and registered downloads, filterable by agent/kind.
/// </summary>
[ApiController]
[Route("api/loot")]
[Authorize]
public class LootController : ControllerBase
{
    private readonly LootService _loot;

    public LootController(LootService loot)
    {
        _loot = loot;
    }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? agentId,
        [FromQuery] string? kind,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 40,
        CancellationToken ct = default)
    {
        var (items, total) = await _loot.GetAsync(agentId, kind, page, pageSize, ct);
        return Ok(new { items, total });
    }

    [HttpGet("{id}/content")]
    public async Task<IActionResult> Content(string id, CancellationToken ct)
    {
        var item = await _loot.GetByIdAsync(id, ct);
        if (item == null || !System.IO.File.Exists(item.FilePath))
            return NotFound();

        var contentType = item.Kind == "screenshot" ? "image/jpeg" : "application/octet-stream";
        var bytes = await System.IO.File.ReadAllBytesAsync(item.FilePath, ct);
        return File(bytes, contentType, item.Name);
    }
}
