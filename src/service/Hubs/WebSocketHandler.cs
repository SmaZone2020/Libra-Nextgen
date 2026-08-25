using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Hubs;

/// <summary>
/// Handles WebSocket upgrade for /ws/console only（管理端 UI 事件通道）。
/// 零 WS 架构：agent 不再有任何 WebSocket 连接；一切 agent 交互走
/// SSE 任务推送 + HTTP 结果上报。
/// </summary>
public static class WebSocketHandler
{
    private const int MaxMessageSize = 4 * 1024 * 1024; // 4 MB cap to prevent memory exhaustion

    public static void Map(IEndpointRouteBuilder app)
    {
        app.Map("/ws/console", HandleConsoleWs).RequireAuthorization();
    }

    private static async Task HandleConsoleWs(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = 400;
            return;
        }

        var user = context.User;
        var userId = user.Identity?.Name ?? context.Connection.Id;
        var role = user.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "Operator";

        var ws = await context.WebSockets.AcceptWebSocketAsync();
        var wsManager = context.RequestServices.GetRequiredService<ConnectionManager>();

        var connId = Guid.NewGuid().ToString("N");
        wsManager.AddConnection(connId, ws, userId, role, "console");

        // 事件溯源：回放最近事件，让新连接补齐状态。
        try
        {
            foreach (var e in wsManager.GetRecentEvents(100))
            {
                var replay = new WebSocketMessage
                {
                    Type = "event.item",
                    Channel = "global",
                    Data = JsonSerializer.SerializeToElement(e)
                };
                await wsManager.SendToConnectionAsync(connId, replay);
            }
        }
        catch { /* best-effort */ }

        try
        {
            await ConsoleReceiveLoop(ws, connId, wsManager);
        }
        finally
        {
            wsManager.RemoveConnection(connId);
        }
    }

    private static async Task ConsoleReceiveLoop(
        WebSocket ws, string connId, ConnectionManager wsManager)
    {
        var buffer = new byte[8192];

        while (ws.State == WebSocketState.Open)
        {
            var ms = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                if (result.MessageType == WebSocketMessageType.Close) break;
                ms.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            if (ms.Length > MaxMessageSize)
            {
                await ws.CloseAsync(WebSocketCloseStatus.MessageTooBig, "message too big", CancellationToken.None);
                break;
            }

            if (result.MessageType == WebSocketMessageType.Close)
            {
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None);
                break;
            }

            if (result.MessageType == WebSocketMessageType.Text)
            {
                var json = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
                var message = WebSocketMessage.FromJson(json);
                if (message == null) continue;

                // 零 WS 架构：agent 交互全部走任务制（REST + SSE）。
                // 控制台消息仅做事件广播。
                await wsManager.BroadcastToConsoleAsync(message);
            }
        }
    }
}
