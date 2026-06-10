using System.Text;
using System.Text.Json;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/media")]
[Authorize]
public class MediaController : ControllerBase
{
    private readonly ConnectionManager _wsManager;

    public MediaController(ConnectionManager wsManager)
    {
        _wsManager = wsManager;
    }

    [HttpGet("camera/devices/{agentId}")]
    public async Task<IActionResult> GetCameraDevices(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "camera.list", null, ct);
    }

    [HttpGet("mic/devices/{agentId}")]
    public async Task<IActionResult> GetMicDevices(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "mic.list", null, ct);
    }

    [HttpGet("camera/stream/{agentId}")]
    public async Task StreamCamera(string agentId, [FromServices] AgentTrafficService traffic, CancellationToken ct)
    {
        Response.Headers["Content-Type"] = "text/event-stream; charset=utf-8";
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no";
        Response.Headers["Connection"] = "keep-alive";

        var channel = ScreenStreamManager.Subscribe($"camera:{agentId}");
        try
        {
            await foreach (var json in channel.Reader.ReadAllAsync(ct))
            {
                var payload = $"data: {json}\n\n";
                await Response.WriteAsync(payload, ct);
                await Response.Body.FlushAsync(ct);
                traffic.Accumulate(agentId, "unknown", 0, Encoding.UTF8.GetByteCount(payload));
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            ScreenStreamManager.Unsubscribe($"camera:{agentId}", channel);
        }
    }

    [HttpGet("mic/stream/{agentId}")]
    public async Task StreamMic(string agentId, [FromServices] AgentTrafficService traffic, CancellationToken ct)
    {
        Response.Headers["Content-Type"] = "text/event-stream; charset=utf-8";
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no";
        Response.Headers["Connection"] = "keep-alive";

        var channel = ScreenStreamManager.Subscribe($"mic:{agentId}");
        try
        {
            await foreach (var json in channel.Reader.ReadAllAsync(ct))
            {
                var payload = $"data: {json}\n\n";
                await Response.WriteAsync(payload, ct);
                await Response.Body.FlushAsync(ct);
                traffic.Accumulate(agentId, "unknown", 0, Encoding.UTF8.GetByteCount(payload));
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            ScreenStreamManager.Unsubscribe($"mic:{agentId}", channel);
        }
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
            var response = await tcs.Task.WaitAsync(TimeSpan.FromSeconds(15), ct);
            return response.Data != null
                ? Content(response.Data.Value.GetRawText(), "application/json")
                : Ok(new { status = "ok" });
        }
        catch (TimeoutException)
        {
            _wsManager.CompletePendingRequest(requestId, null!);
            return StatusCode(504, new { error = "Request timed out" });
        }
    }
}
