using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/access-keys")]
[Authorize]
public class AccessKeysController : ControllerBase
{
    private readonly AccessKeyService _service;

    public AccessKeysController(AccessKeyService service)
    {
        _service = service;
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateAccessKeyRequest request)
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "";
        var userName = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        var role = User.IsInRole("Admin") ? "Admin" : "Operator";

        var (key, rawKey) = await _service.CreateAsync(request.Name, request.ExpiresAt, userId, userName, role);

        return Ok(new
        {
            id = key.Id,
            name = key.Name,
            key = rawKey,
            role = key.Role,
            createdAt = key.CreatedAt,
            expiresAt = key.ExpiresAt,
        });
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "";
        var isAdmin = User.IsInRole("Admin");

        var keys = await _service.ListAsync(userId, isAdmin);

        var result = keys.Select(k => new
        {
            id = k.Id,
            name = k.Name,
            keyPreview = k.KeyHash.Length > 12 ? k.KeyHash[..12] + "..." : k.KeyHash,
            role = k.Role,
            createdByUserName = k.CreatedByUserName,
            createdAt = k.CreatedAt,
            expiresAt = k.ExpiresAt,
            lastUsedAt = k.LastUsedAt,
            isActive = k.IsActive,
        });

        return Ok(result);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "";
        var isAdmin = User.IsInRole("Admin");

        var deleted = await _service.DeleteAsync(id, userId, isAdmin);
        if (!deleted) return NotFound();
        return NoContent();
    }
}

public class CreateAccessKeyRequest
{
    public string Name { get; set; } = "";
    public DateTime? ExpiresAt { get; set; }
}
