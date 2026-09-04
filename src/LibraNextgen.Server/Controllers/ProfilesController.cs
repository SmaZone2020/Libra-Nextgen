using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Profiles;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/profiles")]
[Authorize(Roles = "Admin")]
public class ProfilesController : ControllerBase
{
    private readonly ProfileService _profileService;

    public ProfilesController(ProfileService profileService)
    {
        _profileService = profileService;
    }

    /// <summary>
    /// List all C2 traffic profiles.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken ct)
    {
        var profiles = await _profileService.GetAllAsync(ct);
        return Ok(profiles);
    }

    /// <summary>
    /// Get a specific profile by ID.
    /// </summary>
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id, CancellationToken ct)
    {
        var profile = await _profileService.GetByIdAsync(id, ct);
        if (profile == null) return NotFound();
        return Ok(profile);
    }

    /// <summary>
    /// Create a new C2 traffic profile.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] MalleableProfileConfig config, CancellationToken ct)
    {
        var username = User.Identity?.Name ?? "unknown";
        var created = await _profileService.CreateAsync(config, username, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    /// <summary>
    /// Activate a profile (deactivates all others).
    /// </summary>
    [HttpPost("{id}/activate")]
    public async Task<IActionResult> Activate(string id, CancellationToken ct)
    {
        var success = await _profileService.ActivateAsync(id, ct);
        if (!success) return NotFound();
        return Ok(new { status = "activated" });
    }

    /// <summary>
    /// Delete a profile.
    /// </summary>
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var deleted = await _profileService.DeleteAsync(id, ct);
        if (deleted == 0) return NotFound();
        return NoContent();
    }
}
