using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AuthService _authService;

    public AuthController(AuthService authService)
    {
        _authService = authService;
    }

    /// <summary>
    /// Login and receive a JWT token.
    /// </summary>
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var response = await _authService.LoginAsync(request, ip);

        if (response == null)
            return Unauthorized(new { error = "Invalid username or password" });

        return Ok(response);
    }

    /// <summary>
    /// Check if setup is needed (no users exist yet).
    /// </summary>
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var needsSetup = await _authService.NeedsSetupAsync();
        return Ok(new { needsSetup });
    }

    /// <summary>
    /// First-time setup: create the initial admin account.
    /// </summary>
    [HttpPost("setup")]
    public async Task<IActionResult> Setup([FromBody] SetupRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Length < 2)
            return BadRequest(new { error = "Username must be at least 2 characters." });

        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 6)
            return BadRequest(new { error = "Password must be at least 6 characters." });

        if (request.Password != request.ConfirmPassword)
            return BadRequest(new { error = "Passwords do not match." });

        try
        {
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var response = await _authService.SetupAsync(request.Username, request.Password, ip);
            return Ok(response);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Verify if the current token is still valid.
    /// </summary>
    [HttpGet("verify")]
    public IActionResult Verify()
    {
        var username = User.Identity?.Name ?? "unknown";
        var role = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "Operator";
        return Ok(new { username, role, valid = true });
    }
}
