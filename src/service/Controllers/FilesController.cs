using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/files")]
[Authorize]
public class FilesController : ControllerBase
{
    private readonly ConnectionManager _wsManager;

    public FilesController(ConnectionManager wsManager)
    {
        _wsManager = wsManager;
    }

    /// <summary>
    /// Send a file operation request to the agent and await its response.
    /// </summary>
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

    [HttpPost("{agentId}/list")]
    public async Task<IActionResult> ListDirectory(string agentId, [FromBody] ListRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.list", new { path = req.Path }, ct);
    }

    [HttpPost("{agentId}/drives")]
    public async Task<IActionResult> GetDrives(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.drives", null, ct);
    }

    [HttpPost("{agentId}/read")]
    public async Task<IActionResult> ReadFile(string agentId, [FromBody] ReadRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.read", new { path = req.Path }, ct);
    }

    [HttpPost("{agentId}/write")]
    public async Task<IActionResult> WriteFile(string agentId, [FromBody] WriteRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.write", new { path = req.Path, content = req.Content }, ct);
    }

    [HttpDelete("{agentId}")]
    public async Task<IActionResult> DeleteFile(string agentId, [FromBody] DeleteRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.delete", new { path = req.Path }, ct);
    }

    [HttpPost("{agentId}/mkdir")]
    public async Task<IActionResult> CreateDirectory(string agentId, [FromBody] MkdirRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.mkdir", new { path = req.Path }, ct);
    }
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

public record ListRequest(string Path);
public record ReadRequest(string Path);
public record WriteRequest(string Path, string Content);
public record DeleteRequest(string Path);
public record MkdirRequest(string Path);
