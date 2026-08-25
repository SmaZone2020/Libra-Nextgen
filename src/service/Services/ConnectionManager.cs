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
    /// <summary>已下发、尚未回包的 requestId 集合 —— 用于校验 agent 回包的真实性。</summary>
    private readonly ConcurrentDictionary<string, byte> _issuedRequestIds = new();

    // ── 事件溯源（Event sourcing）────────────────────────────────────────

    /// <summary>一条全局事件（agent 上线/下线、任务、操作员、会话协作）。</summary>
    public record EventEntry(string Id, string Kind, string Text, DateTime Ts);

    private readonly ConcurrentQueue<EventEntry> _eventLog = new();
    private const int MaxEventLog = 500;

    /// <summary>追加一条事件：写入有序日志并实时广播给所有 console。</summary>
    public void AppendEvent(string kind, string text)
    {
        var entry = new EventEntry(Guid.NewGuid().ToString("N"), kind, text, DateTime.UtcNow);
        _eventLog.Enqueue(entry);
        while (_eventLog.Count > MaxEventLog)
            _eventLog.TryDequeue(out _);

        var msg = new WebSocketMessage
        {
            Type = "event.item",
            Channel = "global",
            Data = JsonSerializer.SerializeToElement(entry)
        };
        _ = BroadcastToConsoleAsync(msg);
    }

    /// <summary>取最近 N 条事件（新 console 连接时回放补齐状态）。</summary>
    public List<EventEntry> GetRecentEvents(int count = 100)
        => _eventLog.Reverse().Take(count).Reverse().ToList();
    private readonly ISessionLock _sessionLock;
    private readonly AgentTrafficService _traffic;
    private readonly SessionKeyStore _sessionKeys;

    public ConnectionManager(ISessionLock sessionLock, AgentTrafficService traffic, SessionKeyStore sessionKeys)
    {
        _sessionLock = sessionLock;
        _traffic = traffic;
        _sessionKeys = sessionKeys;
    }

    /// <summary>
    /// Encrypt a message destined for an agent using its session key, wrapping
    /// it in <c>{ "e": "..." }</c>. Returns <c>null</c> when no session key is
    /// established — plaintext fallback is NOT allowed, so the caller must skip
    /// sending instead of leaking the message.
    /// </summary>
    private string? WrapAgentMessage(string agentId, string json)
    {
        if (_sessionKeys.TryGet(agentId, out var key) && key is not null)
        {
            return JsonSerializer.Serialize(new { e = CryptoHelper.EncryptPayload(json, key) });
        }
        return null;
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
        _issuedRequestIds[requestId] = 0;
        _pendingRequests[requestId] = tcs;
        // Auto-cleanup after 30s to prevent memory leaks
        _ = Task.Delay(TimeSpan.FromSeconds(30)).ContinueWith(t =>
        {
            if (_pendingRequests.TryRemove(requestId, out var stale))
            {
                _issuedRequestIds.TryRemove(requestId, out var _);
                stale.TrySetCanceled();
            }
        });
        return tcs;
    }

    /// <summary>
    /// Complete a pending request with the agent's response.
    /// Returns true if a matching request was found and completed.
    /// </summary>
    public bool CompletePendingRequest(string requestId, WebSocketMessage message)
    {
        // 只有已下发的 rid 才允许完成回包；未登记（伪造或已超时）直接拒绝。
        if (!_issuedRequestIds.TryRemove(requestId, out _))
        {
            return false;
        }

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
                var json = WrapAgentMessage(agentId, message.ToJson());
                if (json is null)
                {
                    // No session key — refuse to send plaintext.
                    return;
                }
                var bytes = Encoding.UTF8.GetBytes(json);
                _traffic.Accumulate(agentId, "unknown", 0, bytes.Length);
                await SendLockedAsync(info, new ArraySegment<byte>(bytes), WebSocketMessageType.Text, ct);
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
                tasks.Add(SendIgnoringErrorsAsync(info, segment, WebSocketMessageType.Text, ct));
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
        await SendLockedAsync(info, new ArraySegment<byte>(bytes), WebSocketMessageType.Text, ct);
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
            await SendLockedAsync(operatorInfo, new ArraySegment<byte>(Encoding.UTF8.GetBytes(notify.ToJson())), WebSocketMessageType.Text, ct);
            return;
        }

        // Find the agent's WS connection and forward input
        foreach (var (_, info) in _connections)
        {
            if (info.Type == "agent" && info.AgentId == agentId && info.Socket.State == WebSocketState.Open)
            {
                var json = WrapAgentMessage(agentId, message.ToJson());
                if (json is null)
                {
                    // No session key — refuse to send plaintext.
                    return;
                }
                var bytes = Encoding.UTF8.GetBytes(json);
                _traffic.Accumulate(agentId, "unknown", 0, bytes.Length);
                await SendLockedAsync(info, new ArraySegment<byte>(bytes), WebSocketMessageType.Text, ct);
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
                tasks.Add(SendIgnoringErrorsAsync(info, new ArraySegment<byte>(bytes), WebSocketMessageType.Text, ct));
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

    public bool IsAgentConnected(string agentId)
    {
        foreach (var (_, info) in _connections)
        {
            if (info.Type == "agent" && info.AgentId == agentId && info.Socket.State == WebSocketState.Open)
                return true;
        }
        return false;
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
        public SemaphoreSlim SendLock { get; } = new(1, 1);
    }

    /// <summary>
    /// Serializes sends per socket — WebSocket.SendAsync is not reentrant and
    /// concurrent calls throw.
    /// </summary>
    private static async Task SendLockedAsync(
        ConnectionInfo info, ArraySegment<byte> segment, WebSocketMessageType type, CancellationToken ct)
    {
        await info.SendLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await info.Socket.SendAsync(segment, type, true, ct).ConfigureAwait(false);
        }
        finally
        {
            info.SendLock.Release();
        }
    }

    private static async Task SendIgnoringErrorsAsync(
        ConnectionInfo info, ArraySegment<byte> segment, WebSocketMessageType type, CancellationToken ct)
    {
        try
        {
            await SendLockedAsync(info, segment, type, ct).ConfigureAwait(false);
        }
        catch
        {
            // Best-effort: a single failed connection must not fail the broadcast.
        }
    }
}
