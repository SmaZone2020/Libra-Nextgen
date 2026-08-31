using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// Token vault operations. High-risk: token theft/impersonation is audited and
/// restricted to authorized operators (RBAC + audit middleware).
/// </summary>
[ApiController]
[Route("api/token")]
[Authorize]
public class TokenController : ControllerBase
{
    private readonly RelayService _relay;

    public TokenController(RelayService relay)
    {
        _relay = relay;
    }

    private async Task<IActionResult> RelayAndWaitAsync(
        string agentId, object data, CancellationToken ct, int timeoutSeconds = 30)
    {
        var response = await _relay.RelayAndWaitAsync(agentId, "token", data, ct,
            TimeSpan.FromSeconds(timeoutSeconds), createdBy: User.Identity?.Name ?? "system-relay");
        if (response == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });
        return Content(response, "application/json");
    }

    [HttpPost("{agentId}/list")]
    public Task<IActionResult> List(string agentId, CancellationToken ct)
        => RelayAndWaitAsync(agentId, new { op = "list" }, ct, 60);

    [HttpPost("{agentId}/steal")]
    public Task<IActionResult> Steal(string agentId, [FromBody] StealRequest req, CancellationToken ct)
        => RelayAndWaitAsync(agentId, new { op = "steal", pid = req.Pid }, ct);

    [HttpPost("{agentId}/make")]
    public Task<IActionResult> Make(string agentId, [FromBody] MakeRequest req, CancellationToken ct)
        => RelayAndWaitAsync(agentId, new { op = "make", username = req.Username, password = req.Password, domain = req.Domain }, ct);

    [HttpPost("{agentId}/impersonate")]
    public Task<IActionResult> Impersonate(string agentId, [FromBody] ImpersonateRequest req, CancellationToken ct)
        => RelayAndWaitAsync(agentId, new { op = "impersonate", id = req.Id, pid = req.Pid }, ct);

    [HttpPost("{agentId}/revert")]
    public Task<IActionResult> Revert(string agentId, CancellationToken ct)
        => RelayAndWaitAsync(agentId, new { op = "revert" }, ct);
}

public class StealRequest
{
    public uint Pid { get; set; }
}

public class MakeRequest
{
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string Domain { get; set; } = ".";
}

public class ImpersonateRequest
{
    public uint Id { get; set; }
    public uint Pid { get; set; }
}
