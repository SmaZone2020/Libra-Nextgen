using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Hubs;

/// <summary>
/// Handles WebSocket upgrade for /ws/console and /ws/agent endpoints.
/// </summary>
public static class WebSocketHandler
{
    public static void Map(IEndpointRouteBuilder app)
    {
        app.Map("/ws/console", HandleConsoleWs);
        app.Map("/ws/agent", HandleAgentWs);
    }

    private static async Task HandleConsoleWs(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = 400;
            return;
        }

        var user = context.User;
        var userId = user.Identity?.Name ?? "anonymous";
        var role = user.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "Operator";

        var ws = await context.WebSockets.AcceptWebSocketAsync();
        var wsManager = context.RequestServices.GetRequiredService<ConnectionManager>();
        var sessionLock = context.RequestServices.GetRequiredService<ISessionLock>();

        var connId = Guid.NewGuid().ToString("N");
        wsManager.AddConnection(connId, ws, userId, role, "console");

        try
        {
            await ConsoleReceiveLoop(ws, connId, wsManager, sessionLock, context);
        }
        finally
        {
            wsManager.RemoveConnection(connId);
        }
    }

    private static async Task ConsoleReceiveLoop(
        WebSocket ws, string connId, ConnectionManager wsManager,
        ISessionLock sessionLock, HttpContext context)
    {
        var buffer = new byte[8192];

        while (ws.State == WebSocketState.Open)
        {
            var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);

            if (result.MessageType == WebSocketMessageType.Close)
            {
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None);
                break;
            }

            if (result.MessageType == WebSocketMessageType.Text)
            {
                var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                var message = WebSocketMessage.FromJson(json);
                if (message == null) continue;

                await HandleConsoleMessage(message, connId, wsManager, sessionLock, context);
            }
        }
    }

    private static async Task HandleConsoleMessage(
        WebSocketMessage message, string connId, ConnectionManager wsManager,
        ISessionLock sessionLock, HttpContext context)
    {
        switch (message.Type)
        {
            case "shell.bind":
                var agentId = message.Data?.GetProperty("agentId").GetString();
                if (agentId == null) break;

                wsManager.BindToAgent(connId, agentId);

                var acquired = sessionLock.TryAcquireWriteLock(agentId, connId, out var writerId);
                var lockMsg = new WebSocketMessage
                {
                    Type = acquired ? WsMessageType.ShellLockAcquired : WsMessageType.ShellObserverJoined,
                    Channel = agentId,
                    Data = JsonSerializer.SerializeToElement(new
                    {
                        writerId = writerId,
                        mode = acquired ? "write" : "readonly"
                    })
                };
                await wsManager.SendToConnectionAsync(connId, lockMsg);
                break;

            case "shell.unbind":
                var unbindAgentId = message.Data?.GetProperty("agentId").GetString();
                if (unbindAgentId != null)
                {
                    sessionLock.ReleaseWriteLock(unbindAgentId, connId);
                    sessionLock.RemoveObserver(unbindAgentId, connId);
                    wsManager.BindToAgent(connId, null!);
                }
                break;

            case "shell.input":
                var inputAgentId = message.Channel;
                if (!string.IsNullOrEmpty(inputAgentId))
                {
                    await wsManager.RelayToAgentShellAsync(inputAgentId, connId, message);
                }
                break;

            default:
                await wsManager.BroadcastToConsoleAsync(message);
                break;
        }
    }

    private static async Task HandleAgentWs(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = 400;
            return;
        }

        var agentId = context.Request.Query["agentId"].FirstOrDefault() ?? "unknown";
        var ws = await context.WebSockets.AcceptWebSocketAsync();
        var wsManager = context.RequestServices.GetRequiredService<ConnectionManager>();
        var connId = Guid.NewGuid().ToString("N");
        wsManager.AddConnection(connId, ws, agentId, "agent", "agent");
        wsManager.BindToAgent(connId, agentId);

        var buffer = new byte[8192];
        try
        {
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None);
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    var message = WebSocketMessage.FromJson(json);
                    if (message == null) continue;

                    message.Channel = agentId;
                    await wsManager.BroadcastShellOutputAsync(agentId, message);
                }
            }
        }
        finally
        {
            wsManager.RemoveConnection(connId);
        }
    }
}
