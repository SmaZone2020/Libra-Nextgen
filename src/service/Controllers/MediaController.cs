using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/media")]
[Authorize]
public class MediaController : ControllerBase
{
    [HttpGet("camera/stream/{agentId}")]
    public async Task StreamCamera(string agentId, CancellationToken ct)
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
                await Response.WriteAsync($"data: {json}\n\n", ct);
                await Response.Body.FlushAsync(ct);
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            ScreenStreamManager.Unsubscribe($"camera:{agentId}", channel);
        }
    }

    [HttpGet("mic/stream/{agentId}")]
    public async Task StreamMic(string agentId, CancellationToken ct)
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
                await Response.WriteAsync($"data: {json}\n\n", ct);
                await Response.Body.FlushAsync(ct);
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            ScreenStreamManager.Unsubscribe($"mic:{agentId}", channel);
        }
    }
}
