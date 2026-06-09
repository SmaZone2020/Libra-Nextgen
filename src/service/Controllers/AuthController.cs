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
