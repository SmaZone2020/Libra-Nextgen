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

    public AccountController(AccountService accountService)
    {
        _accountService = accountService;
    }

    private string UserId => User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? User.FindFirst("sub")?.Value
        ?? throw new UnauthorizedAccessException("No user identity.");

    /// <summary>Check if current user is the initial account.</summary>
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var isInitial = await _accountService.IsInitialAccountAsync(UserId);
        return Ok(new { isInitial });
    }

    /// <summary>List all accounts (initial account only).</summary>
    [HttpGet("list")]
    public async Task<IActionResult> List()
    {
        if (!await _accountService.IsInitialAccountAsync(UserId))
            return Forbid();

        var accounts = await _accountService.ListAsync();
        return Ok(accounts);
    }

    /// <summary>Create a new account (initial account only).</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateAccountRequest request)
    {
        if (!await _accountService.IsInitialAccountAsync(UserId))
            return Forbid();

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

    /// <summary>Update an account (initial account only).</summary>
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateAccountRequest request)
    {
        if (!await _accountService.IsInitialAccountAsync(UserId))
            return Forbid();

        try
        {
            await _accountService.UpdateAsync(id, request);
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

    /// <summary>Delete an account (initial account only).</summary>
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        if (!await _accountService.IsInitialAccountAsync(UserId))
            return Forbid();

        try
        {
            await _accountService.DeleteAsync(id, UserId);
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
