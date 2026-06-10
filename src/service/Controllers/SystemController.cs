using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/system")]
[Authorize]
public class SystemController : ControllerBase
{
    private readonly ConnectionManager _wsManager;

    public SystemController(ConnectionManager wsManager)
    {
        _wsManager = wsManager;
    }

    private async Task<IActionResult> RelayAndWaitAsync(string agentId, string messageType, object? data, CancellationToken ct)
    {
        var requestId = Guid.NewGuid().ToString("N");

        var msg = new WebSocketMessage
        {
            Type = messageType,
            Channel = agentId,
            Data = data != null ? JsonSerializer.SerializeToElement(data) : null,
            RequestId = requestId
        };

        var tcs = _wsManager.RegisterPendingRequest(requestId);
        await _wsManager.RelayToAgentAsync(agentId, msg, ct);

        try
        {
            var response = await tcs.Task.WaitAsync(TimeSpan.FromSeconds(30), ct);
            return response.Data != null
                ? Content(response.Data.Value.GetRawText(), "application/json")
                : Ok(new { status = "ok" });
        }
        catch (TimeoutException)
        {
            return StatusCode(504, new { error = "Agent did not respond in time." });
        }
    }

    [HttpPost("{agentId}/processes")]
    public async Task<IActionResult> GetProcesses(string agentId, [FromBody] ProcessesRequest? req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "system.processes", new { lastHash = req?.LastHash }, ct);
    }

    [HttpPost("{agentId}/processes/kill")]
    public async Task<IActionResult> KillProcess(string agentId, [FromBody] KillProcessRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "system.processes.kill", new { pid = req.Pid }, ct);
    }

    [HttpPost("{agentId}/windows")]
    public async Task<IActionResult> GetWindows(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "system.windows", null, ct);
    }

    [HttpPost("{agentId}/env")]
    public async Task<IActionResult> GetEnvVars(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "system.env", null, ct);
    }

    [HttpPost("{agentId}/env/set")]
    public async Task<IActionResult> SetEnvVar(string agentId, [FromBody] SetEnvRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "system.env.set", new { name = req.Name, value = req.Value, scope = req.Scope }, ct);
    }

    [HttpPost("{agentId}/env/delete")]
    public async Task<IActionResult> DeleteEnvVar(string agentId, [FromBody] DeleteEnvRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "system.env.delete", new { name = req.Name, scope = req.Scope }, ct);
    }
}

public record ProcessesRequest(string? LastHash);
public record KillProcessRequest(int Pid);
public record SetEnvRequest(string Name, string Value, string Scope);
public record DeleteEnvRequest(string Name, string Scope);
