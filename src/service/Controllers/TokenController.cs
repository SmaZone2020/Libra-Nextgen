using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Protocol;
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
        string agentId, string messageType, object? data, CancellationToken ct, int timeoutSeconds = 30)
    {
        var response = await _relay.RelayAndWaitAsync(agentId, messageType, data, ct, TimeSpan.FromSeconds(timeoutSeconds));
        if (response == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });
        return response.Data != null
            ? Content(response.Data.Value.GetRawText(), "application/json")
            : Ok(new { status = "ok" });
    }

    [HttpPost("{agentId}/list")]
    public Task<IActionResult> List(string agentId, CancellationToken ct)
        => RelayAndWaitAsync(agentId, "token.list", null, ct, 60);

    [HttpPost("{agentId}/steal")]
    public Task<IActionResult> Steal(string agentId, [FromBody] StealRequest req, CancellationToken ct)
        => RelayAndWaitAsync(agentId, "token.steal", new { pid = req.Pid }, ct);

    [HttpPost("{agentId}/make")]
    public Task<IActionResult> Make(string agentId, [FromBody] MakeRequest req, CancellationToken ct)
        => RelayAndWaitAsync(agentId, "token.make", new { username = req.Username, password = req.Password, domain = req.Domain }, ct);

    [HttpPost("{agentId}/impersonate")]
    public Task<IActionResult> Impersonate(string agentId, [FromBody] ImpersonateRequest req, CancellationToken ct)
        => RelayAndWaitAsync(agentId, "token.impersonate", new { id = req.Id, pid = req.Pid }, ct);

    [HttpPost("{agentId}/revert")]
    public Task<IActionResult> Revert(string agentId, CancellationToken ct)
        => RelayAndWaitAsync(agentId, "token.revert", null, ct);
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
