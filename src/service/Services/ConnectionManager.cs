using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Tracks WebSocket connections and handles message routing/broadcast.
/// </summary>
public class ConnectionManager
{
    private readonly ConcurrentDictionary<string, ConnectionInfo> _connections = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<WebSocketMessage>> _pendingRequests = new();
    private readonly ISessionLock _sessionLock;
    private readonly AgentTrafficService _traffic;

    public ConnectionManager(ISessionLock sessionLock, AgentTrafficService traffic)
    {
        _sessionLock = sessionLock;
        _traffic = traffic;
    }

    public string AddConnection(string connectionId, WebSocket socket, string userId, string role, string type)
    {
        var info = new ConnectionInfo
        {
            ConnectionId = connectionId,
            Socket = socket,
            UserId = userId,
            Role = role,
            Type = type
        };
        _connections[connectionId] = info;
        return connectionId;
    }

    public void RemoveConnection(string connectionId)
    {
        if (_connections.TryRemove(connectionId, out var info))
        {
            if (info.AgentId != null)
            {
                _sessionLock.ReleaseWriteLock(info.AgentId, info.UserId);
                _sessionLock.RemoveObserver(info.AgentId, info.UserId);
            }
        }
    }

    /// <summary>
    /// Register a pending request for REST→Agent→REST correlation.
    /// </summary>
    public TaskCompletionSource<WebSocketMessage> RegisterPendingRequest(string requestId)
    {
        var tcs = new TaskCompletionSource<WebSocketMessage>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingRequests[requestId] = tcs;
        // Auto-cleanup after 30s to prevent memory leaks
        _ = Task.Delay(TimeSpan.FromSeconds(30)).ContinueWith(_ =>
        {
            if (_pendingRequests.TryRemove(requestId, out var stale))
                stale.TrySetCanceled();
        });
        return tcs;
    }

    /// <summary>
    /// Complete a pending request with the agent's response.
    /// Returns true if a matching request was found and completed.
    /// </summary>
    public bool CompletePendingRequest(string requestId, WebSocketMessage message)
    {
        if (_pendingRequests.TryRemove(requestId, out var tcs))
        {
            return tcs.TrySetResult(message);
        }
        return false;
    }

    public void BindToAgent(string connectionId, string agentId)
    {
        if (_connections.TryGetValue(connectionId, out var info))
        {
            info.AgentId = agentId;
        }
    }

    public async Task RelayToAgentAsync(string agentId, WebSocketMessage message, CancellationToken ct = default)
    {
        foreach (var (_, info) in _connections)
        {
            if (info.Type == "agent" && info.AgentId == agentId && info.Socket.State == WebSocketState.Open)
            {
                var json = message.ToJson();
                var bytes = Encoding.UTF8.GetBytes(json);
                _traffic.Accumulate(agentId, "unknown", 0, bytes.Length);
                await info.Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
                return;
            }
        }
    }

    public async Task BroadcastToConsoleAsync(WebSocketMessage message, CancellationToken ct = default)
    {
        var json = message.ToJson();
        var bytes = Encoding.UTF8.GetBytes(json);
        var tasks = new List<Task>();

        foreach (var (_, info) in _connections)
        {
            if (info.Type == "console" && info.Socket.State == WebSocketState.Open)
            {
                var segment = new ArraySegment<byte>(bytes);
                tasks.Add(info.Socket.SendAsync(segment, WebSocketMessageType.Text, true, ct));
            }
        }
        await Task.WhenAll(tasks);
    }

    public async Task SendToConnectionAsync(string connectionId, WebSocketMessage message, CancellationToken ct = default)
    {
        if (!_connections.TryGetValue(connectionId, out var info)) return;
        if (info.Socket.State != WebSocketState.Open) return;

        var json = message.ToJson();
        var bytes = Encoding.UTF8.GetBytes(json);
        await info.Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }

    public async Task RelayToAgentShellAsync(string agentId, string connectionId, WebSocketMessage message, CancellationToken ct = default)
    {
        if (!_connections.TryGetValue(connectionId, out var operatorInfo)) return;

        var writerId = _sessionLock.GetCurrentWriter(agentId);
        if (writerId != operatorInfo.UserId)
        {
            var notify = new WebSocketMessage
            {
                Type = WsMessageType.ShellOutput,
                Channel = agentId,
                Data = JsonSerializer.SerializeToElement(new { text = "\r\n[Shell is locked by another operator. Read-only mode.]\r\n" })
            };
            await SendToConnectionAsync(connectionId, notify, ct);
            return;
        }

        // Find the agent's WS connection and forward input
        foreach (var (_, info) in _connections)
        {
            if (info.Type == "agent" && info.AgentId == agentId && info.Socket.State == WebSocketState.Open)
            {
                var json = message.ToJson();
                var bytes = Encoding.UTF8.GetBytes(json);
                _traffic.Accumulate(agentId, "unknown", 0, bytes.Length);
                await info.Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
                return;
            }
        }
    }

    public async Task BroadcastShellOutputAsync(string agentId, WebSocketMessage message, CancellationToken ct = default)
    {
        var json = message.ToJson();
        var bytes = Encoding.UTF8.GetBytes(json);
        var tasks = new List<Task>();

        foreach (var (_, info) in _connections)
        {
            if (info.Type == "console" && info.AgentId == agentId && info.Socket.State == WebSocketState.Open)
            {
                tasks.Add(info.Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct));
            }
        }
        if (tasks.Count > 0)
            await Task.WhenAll(tasks);
    }

    public List<ConnectionInfo> GetAgentConnections()
    {
        return _connections.Values.Where(c => c.Type == "agent").ToList();
    }

    public bool IsConsoleConnection(string connectionId)
    {
        return _connections.TryGetValue(connectionId, out var info) && info.Type == "console";
    }

    public string GetUserId(string connectionId)
    {
        return _connections.TryGetValue(connectionId, out var info) ? info.UserId : connectionId;
    }

    public class ConnectionInfo
    {
        public string ConnectionId { get; set; } = string.Empty;
        public WebSocket Socket { get; set; } = null!;
        public string UserId { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public string Type { get; set; } = "console"; // "console" or "agent"
        public string? AgentId { get; set; }
    }
}
