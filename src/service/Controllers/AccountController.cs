using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/account")]
[Authorize]
public class AccountController : ControllerBase
{
    private readonly AccountService _accountService;
    private readonly PermissionService _permissionService;

    public AccountController(AccountService accountService, PermissionService permissionService)
    {
        _accountService = accountService;
        _permissionService = permissionService;
    }

    private string UserId => User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? User.FindFirst("sub")?.Value
        ?? throw new UnauthorizedAccessException("No user identity.");

    /// <summary>Current user's role and effective permissions.</summary>
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var role = User.IsInRole("Admin") ? UserRole.Admin : UserRole.Operator;
        var permissions = await _accountService.GetEffectivePermissionsAsync(UserId, role);
        var agreedAt = await _accountService.HasAcceptedAgreementAsync(UserId);
        return Ok(new
        {
            username = User.Identity?.Name ?? "",
            role = role.ToString(),
            permissions,
            agreedAt,
        });
    }

    /// <summary>Record acceptance of the authorized-use agreement.</summary>
    [HttpPost("accept-agreement")]
    public async Task<IActionResult> AcceptAgreement()
    {
        await _accountService.AcceptAgreementAsync(UserId);
        return Ok(new { status = "ok" });
    }

    /// <summary>Check if current user is the initial account.</summary>
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var isInitial = await _accountService.IsInitialAccountAsync(UserId);
        return Ok(new { isInitial });
    }

    /// <summary>List all accounts (Admin only).</summary>
    [HttpGet("list")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> List()
    {
        var accounts = await _accountService.ListAsync();
        return Ok(accounts);
    }

    /// <summary>Create a new account (Admin only).</summary>
    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] CreateAccountRequest request)
    {
        try
        {
            var account = await _accountService.CreateAsync(request);
            return Ok(account);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Update an account (Admin only).</summary>
    [HttpPut("{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateAccountRequest request)
    {
        try
        {
            await _accountService.UpdateAsync(id, request);
            _permissionService.Invalidate(id);
            return Ok(new { status = "ok" });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Delete an account (Admin only).</summary>
    [HttpDelete("{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(string id)
    {
        try
        {
            await _accountService.DeleteAsync(id, UserId);
            _permissionService.Invalidate(id);
            return Ok(new { status = "ok" });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Change own password (all authenticated users).</summary>
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
    {
        try
        {
            await _accountService.ChangePasswordAsync(UserId, request.CurrentPassword, request.NewPassword);
            return Ok(new { status = "ok" });
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { error = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}
