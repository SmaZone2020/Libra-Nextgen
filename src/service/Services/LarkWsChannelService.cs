using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services;

/// <summary>
/// 飞书 WebSocket 长连接帧（官方协议：protobuf 二进制帧）。
/// 字段编号依据 larksuite 官方 SDK / 生态实现（frame.proto）：
///   Header { key:1 string, value:2 string }
///   Frame { seq_id:1 uint64, log_id:2 uint64, service:3 int32, method:4 int32,
///           headers:5 repeated Header, payload_encoding:6 string, payload_type:7 string,
///           payload:8 bytes, log_id_new:9 string }
/// method: 0=CONTROL（ping/pong），1=DATA（event）。
/// 事件帧需回 ACK（原帧 + biz_rt 头 + payload {"code":200}），否则服务端重推。
/// </summary>
public sealed class FeishuFrame
{
    public ulong SeqId { get; set; }
    public ulong LogId { get; set; }
    public int Service { get; set; }
    public int Method { get; set; }
    public List<(string Key, string Value)> Headers { get; } = new();
    public string? PayloadEncoding { get; set; }
    public string? PayloadType { get; set; }
    public byte[]? Payload { get; set; }
    public string? LogIdNew { get; set; }

    public byte[] Serialize()
    {
        using var ms = new MemoryStream(128);
        WriteField(ms, 1, 0); WriteVarint(ms, SeqId);
        WriteField(ms, 2, 0); WriteVarint(ms, LogId);
        WriteField(ms, 3, 0); WriteVarint(ms, (ulong)(uint)Service);
        WriteField(ms, 4, 0); WriteVarint(ms, (ulong)(uint)Method);
        foreach (var (k, v) in Headers)
        {
            using var hm = new MemoryStream(64);
            WriteStringField(hm, 1, k);
            WriteStringField(hm, 2, v);
            WriteBytesField(ms, 5, hm.ToArray());
        }
        if (PayloadEncoding != null) WriteStringField(ms, 6, PayloadEncoding);
        if (PayloadType != null) WriteStringField(ms, 7, PayloadType);
        if (Payload is { Length: > 0 }) WriteBytesField(ms, 8, Payload);
        if (LogIdNew != null) WriteStringField(ms, 9, LogIdNew);
        return ms.ToArray();
    }

    public static FeishuFrame Parse(byte[] data)
    {
        var frame = new FeishuFrame();
        var span = data.AsSpan();
        var pos = 0;
        while (pos < span.Length)
        {
            var key = (int)ReadVarint(span, ref pos);
            var field = key >> 3;
            var wire = key & 7;
            switch (field)
            {
                case 1: frame.SeqId = ReadVarint(span, ref pos); break;
                case 2: frame.LogId = ReadVarint(span, ref pos); break;
                case 3: frame.Service = (int)(uint)ReadVarint(span, ref pos); break;
                case 4: frame.Method = (int)(uint)ReadVarint(span, ref pos); break;
                case 5:
                {
                    var len = (int)ReadVarint(span, ref pos);
                    var nested = span.Slice(pos, len);
                    pos += len;
                    var np = 0;
                    string? k = null, v = null;
                    while (np < nested.Length)
                    {
                        var nk = (int)ReadVarint(nested, ref np);
                        var nf = nk >> 3;
                        var nlen = (int)ReadVarint(nested, ref np);
                        if (nf == 1) k = Encoding.UTF8.GetString(nested.Slice(np, nlen));
                        else if (nf == 2) v = Encoding.UTF8.GetString(nested.Slice(np, nlen));
                        np += nlen;
                    }
                    frame.Headers.Add((k ?? "", v ?? ""));
                    break;
                }
                case 6: frame.PayloadEncoding = ReadString(span, ref pos); break;
                case 7: frame.PayloadType = ReadString(span, ref pos); break;
                case 8:
                {
                    var len = (int)ReadVarint(span, ref pos);
                    frame.Payload = span.Slice(pos, len).ToArray();
                    pos += len;
                    break;
                }
                case 9: frame.LogIdNew = ReadString(span, ref pos); break;
                default:
                    // 跳过未知字段（wire 2 = length-delimited，0 = varint）。
                    if (wire == 0) ReadVarint(span, ref pos);
                    else if (wire == 2) { var l = (int)ReadVarint(span, ref pos); pos += l; }
                    break;
            }
        }
        return frame;
    }

    private static void WriteField(Stream s, int field, int wire) => WriteVarint(s, (ulong)((field << 3) | wire));
    private static void WriteVarint(Stream s, ulong v)
    {
        while (v >= 0x80)
        {
            s.WriteByte((byte)(v | 0x80));
            v >>= 7;
        }
        s.WriteByte((byte)v);
    }
    private static void WriteBytesField(Stream s, int field, byte[] bytes)
    {
        WriteField(s, field, 2);
        WriteVarint(s, (ulong)bytes.Length);
        s.Write(bytes);
    }
    private static void WriteStringField(Stream s, int field, string value) =>
        WriteBytesField(s, field, Encoding.UTF8.GetBytes(value));

    private static ulong ReadVarint(ReadOnlySpan<byte> span, ref int pos)
    {
        ulong result = 0;
        var shift = 0;
        while (true)
        {
            var b = span[pos++];
            result |= (ulong)(b & 0x7F) << shift;
            if ((b & 0x80) == 0) break;
            shift += 7;
        }
        return result;
    }
    private static string ReadString(ReadOnlySpan<byte> span, ref int pos)
    {
        var len = (int)ReadVarint(span, ref pos);
        var s = Encoding.UTF8.GetString(span.Slice(pos, len));
        pos += len;
        return s;
    }
}

/// <summary>
/// 飞书长连接后台服务（免公网回调，适配内网部署）：
/// 为每个启用且 transport=websocket 的 Lark 频道建立官方长连接——
/// 引导 endpoint（POST /callback/ws/endpoint，AppID/AppSecret 鉴权）→
/// 连接 wss → 心跳 ping → 事件帧 ACK → 事件入站管线。
/// </summary>
public class LarkWsChannelService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<LarkWsChannelService> _logger;
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _conns = new();

    public LarkWsChannelService(IServiceScopeFactory scopeFactory, ILogger<LarkWsChannelService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Lark WS channel service started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ReconcileAsync(stoppingToken);
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Lark WS reconcile failed.");
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
        }
        foreach (var cts in _conns.Values) cts.Cancel();
    }

    private async Task ReconcileAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var channels = await scope.ServiceProvider
            .GetRequiredService<AiChannelService>()
            .GetEnabledChannelsAsync(new[] { AiChannelTypes.Lark }, ct);
        var active = new HashSet<string>();

        foreach (var ch in channels)
        {
            // transport=webhook 的频道不走长连接（走公网回调控制器）。
            if (!ch.Config.TryGetValue("transport", out var t) || t != "websocket") continue;
            active.Add(ch.Id);
            if (_conns.ContainsKey(ch.Id)) continue;
            _conns[ch.Id] = new CancellationTokenSource();
            _logger.LogInformation("Starting Lark WS loop for channel {Channel}", ch.Id);
            _ = Task.Run(() => LoopAsync(ch, _conns[ch.Id].Token), ct);
        }
        foreach (var id in _conns.Keys.Where(id => !active.Contains(id)).ToList())
        {
            _logger.LogInformation("Stopping Lark WS loop for channel {Channel}", id);
            _conns[id].Cancel();
            _conns.TryRemove(id, out _);
        }
    }

    private async Task LoopAsync(AiChannel channel, CancellationToken ct)
    {
        var backoff = 5;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var lark = scope.ServiceProvider.GetRequiredService<LarkChannelAdapter>();
                var channels = scope.ServiceProvider.GetRequiredService<AiChannelService>();
                var (url, pingInterval) = await lark.FetchWsEndpointAsync(channel, ct);
                backoff = 5;
                await RunConnectionAsync(lark, channels, channel, url, pingInterval, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Lark WS loop error (channel {Channel})", channel.Id);
                try { await Task.Delay(TimeSpan.FromSeconds(backoff), ct); }
                catch (OperationCanceledException) { break; }
                backoff = Math.Min(backoff * 2, 60);
            }
        }
        _logger.LogInformation("Lark WS loop ended (channel {Channel})", channel.Id);
    }

    private async Task RunConnectionAsync(
        LarkChannelAdapter lark, AiChannelService channels,
        AiChannel channel, string url, int pingInterval, CancellationToken ct)
    {
        var serviceId = ParseServiceId(url);
        using var ws = new ClientWebSocket();
        await ws.ConnectAsync(new Uri(url), ct);
        _logger.LogInformation("Lark WS connected (channel {Channel})", channel.Id);

        var buffer = new byte[128 * 1024];
        // 分片重组缓存：message_id → (seq → data)
        var fragments = new Dictionary<string, SortedDictionary<int, byte[]>>();
        var lastPing = DateTime.UtcNow;

        while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
        {
            if (DateTime.UtcNow - lastPing > TimeSpan.FromSeconds(pingInterval))
            {
                await SendPingAsync(ws, serviceId, ct);
                lastPing = DateTime.UtcNow;
            }

            using var recvCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            recvCts.CancelAfter(TimeSpan.FromSeconds(Math.Max(pingInterval, 60) + 15));
            WebSocketReceiveResult result;
            try
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), recvCts.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                // 心跳窗口内无任何帧 → 判定连接死亡，走外层重连。
                _logger.LogWarning("Lark WS receive timeout (channel {Channel}), reconnecting", channel.Id);
                return;
            }
            if (result.MessageType == WebSocketMessageType.Close) return;
            if (result.MessageType != WebSocketMessageType.Binary) continue;

            var frame = FeishuFrame.Parse(buffer.AsSpan(0, result.Count).ToArray());
            await HandleFrameAsync(lark, channels, ws, channel, frame, fragments, ct);
        }
    }

    private async Task HandleFrameAsync(
        LarkChannelAdapter lark, AiChannelService channels, ClientWebSocket ws, AiChannel channel,
        FeishuFrame frame, Dictionary<string, SortedDictionary<int, byte[]>> fragments, CancellationToken ct)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (k, v) in frame.Headers) headers[k] = v;
        var type = headers.GetValueOrDefault("type", "");

        if (frame.Method == 0) // CONTROL
        {
            if (type == "ping")
            {
                var pong = new FeishuFrame { Method = 0, Service = frame.Service };
                pong.Headers.Add(("type", "pong"));
                await ws.SendAsync(new ArraySegment<byte>(pong.Serialize()), WebSocketMessageType.Binary, true, ct);
            }
            return;
        }
        if (frame.Method != 1 || type != "event") return;

        // 分片重组（sum>1 时按 message_id + seq 拼装）。
        var payload = frame.Payload;
        var sum = headers.TryGetValue("sum", out var s) && int.TryParse(s, out var sv) ? sv : 1;
        if (sum > 1)
        {
            var mid = headers.GetValueOrDefault("message_id", "");
            var seq = headers.TryGetValue("seq", out var sq) && int.TryParse(sq, out var qv) ? qv : 0;
            if (mid.Length == 0) return;
            if (!fragments.TryGetValue(mid, out var parts))
                fragments[mid] = parts = new SortedDictionary<int, byte[]>();
            parts[seq] = frame.Payload ?? Array.Empty<byte>();
            if (parts.Count < sum) return; // 未收齐
            using var ms = new MemoryStream();
            foreach (var p in parts.Values) ms.Write(p);
            payload = ms.ToArray();
            fragments.Remove(mid);
        }

        if (payload is { Length: > 0 })
        {
            try
            {
                var root = JsonNode.Parse(Encoding.UTF8.GetString(payload)) as JsonObject;
                if (root != null)
                {
                    var msg = lark.ParseEventEnvelope(channel, root);
                    if (msg != null)
                    {
                        // 事件处理（审批挂起可能阻塞）不阻塞 WS 读取循环：
                        // 立即 ACK 并异步处理，避免事件堆积导致重推风暴。
                        var m = msg;
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                await channels.HandleInboundAsync(m, ct);
                            }
                            catch (Exception ex)
                            {
                                _logger.LogWarning(ex, "Lark inbound handling failed (channel {Channel})", channel.Id);
                            }
                        }, ct);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Lark WS event handling failed (channel {Channel})", channel.Id);
            }
        }

        // ACK：原帧回传 + biz_rt 头 + {"code":200}。
        var ack = new FeishuFrame
        {
            SeqId = frame.SeqId,
            LogId = frame.LogId,
            Service = frame.Service,
            Method = frame.Method,
            Payload = Encoding.UTF8.GetBytes("{\"code\":200}"),
        };
        foreach (var h in frame.Headers) ack.Headers.Add(h);
        ack.Headers.Add(("biz_rt", "0"));
        await ws.SendAsync(new ArraySegment<byte>(ack.Serialize()), WebSocketMessageType.Binary, true, ct);
    }

    private static async Task SendPingAsync(ClientWebSocket ws, int serviceId, CancellationToken ct)
    {
        var ping = new FeishuFrame { Method = 0, Service = serviceId };
        ping.Headers.Add(("type", "ping"));
        await ws.SendAsync(new ArraySegment<byte>(ping.Serialize()), WebSocketMessageType.Binary, true, ct);
    }

    private static int ParseServiceId(string url)
    {
        try
        {
            var qs = System.Web.HttpUtility.ParseQueryString(new Uri(url).Query);
            return int.TryParse(qs["service_id"], out var id) ? id : 0;
        }
        catch
        {
            return 0;
        }
    }
}
