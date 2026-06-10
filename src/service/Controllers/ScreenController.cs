using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/screen")]
[Authorize]
public class ScreenController : ControllerBase
{
    [HttpGet("stream/{agentId}")]
    public async Task StreamScreen(string agentId, CancellationToken ct)
    {
        Response.Headers["Content-Type"] = "text/event-stream; charset=utf-8";
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no";
        Response.Headers["Connection"] = "keep-alive";

        var channel = ScreenStreamManager.Subscribe(agentId);
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
            ScreenStreamManager.Unsubscribe(agentId, channel);
        }
    }
}
