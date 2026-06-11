using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Agent.Communication;

public class WsCommunicator
{
    private ClientWebSocket? _ws;
    private readonly string _url;
    private readonly string _agentId;

    public WsCommunicator(string baseUrl, string agentId)
    {
        _agentId = agentId;
        var uri = new Uri(baseUrl.Replace("http://", "ws://").Replace("https://", "wss://"));
        // Force IPv4 to avoid dual-stack resolution issues
        var host = uri.Host == "localhost" ? "127.0.0.1" : uri.Host;
        _url = $"ws://{host}:{uri.Port}/ws/agent?agentId={agentId}";
    }

    public bool IsConnected => _ws?.State == WebSocketState.Open;

    public async Task ConnectAsync(CancellationToken ct = default)
    {
        _ws = new ClientWebSocket();
        await _ws.ConnectAsync(new Uri(_url), ct);
    }

    public async Task<WebSocketMessage?> ReceiveAsync(CancellationToken ct = default)
    {
        if (_ws == null || _ws.State != WebSocketState.Open) return null;

        var buffer = new byte[8192];
        var ms = new MemoryStream();

        try
        {
            WebSocketReceiveResult result;
            do
            {
                result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", ct);
                    return null;
                }
                ms.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            var json = Encoding.UTF8.GetString(ms.ToArray());
            return WebSocketMessage.FromJson(json);
        }
        catch (WebSocketException)
        {
            return null;
        }
    }

    public async Task SendAsync(WebSocketMessage message, CancellationToken ct = default)
    {
        if (_ws == null || _ws.State != WebSocketState.Open) return;

        var json = message.ToJson();
        var bytes = Encoding.UTF8.GetBytes(json);
        await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }

    /// <summary>
    /// Send a result using a raw JSON string (AOT-safe — uses JsonDocument instead of reflection).
    /// </summary>
    public async Task SendResultRawAsync(string type, string agentId, string dataJson, string? requestId = null, CancellationToken ct = default)
    {
        using var doc = JsonDocument.Parse(dataJson);
        var msg = new WebSocketMessage
        {
            Type = type,
            Channel = agentId,
            Data = doc.RootElement.Clone(),
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            RequestId = requestId
        };
        await SendAsync(msg, ct);
    }

    public async Task CloseAsync()
    {
        if (_ws is { State: WebSocketState.Open })
        {
            try
            {
                await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
            }
            catch { /* ignore */ }
        }
        _ws?.Dispose();
        _ws = null;
    }

    public void Dispose()
    {
        _ws?.Dispose();
        _ws = null;
    }
}
