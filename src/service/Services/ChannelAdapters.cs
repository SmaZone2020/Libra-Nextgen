using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Service.Services;

/// <summary>频道类型常量。</summary>
public static class AiChannelTypes
{
    public const string Telegram = "telegram";
    public const string Lark = "lark";
    public const string WechatClaw = "wechat-claw";

    /// <summary>配置中需要静态加密的敏感键。</summary>
    public static readonly HashSet<string> SensitiveKeys = new(StringComparer.Ordinal)
    {
        "botToken", "appSecret", "encryptKey", "ilinkKey", "webhookSecret",
    };

    /// <summary>长轮询型频道（由 ChannelPollingHostedService 驱动）。</summary>
    public static readonly string[] PollingTypes = { Telegram, WechatClaw };
}

/// <summary>适配器规范化后的入站消息（频道无关）。</summary>
public sealed class ChannelInboundMessage
{
    public required string ChannelId { get; init; }
    public required string ExternalId { get; init; }
    public string ExternalName { get; init; } = "";
    public required string Text { get; init; }
    /// <summary>
    /// 幂等去重键（Telegram update_id / 飞书 event_id / iLink message_id）。
    /// 非空时由 AiChannelService 在入站管线入口去重，防御并发循环 / 重启重放。
    /// </summary>
    public string? DedupeKey { get; init; }
}

/// <summary>轮询型适配器一次拉取的增量批次。游标为频道不透明字符串（Telegram update_id / iLink get_updates_buf）。</summary>
public sealed class ChannelPollBatch
{
    public string? NewCursor { get; init; }
    public List<ChannelInboundMessage> Messages { get; init; } = new();
}

/// <summary>AI 频道适配器统一抽象。入站两种形态：长轮询（PollAsync）或 Webhook/长连接（解析函数）。</summary>
public interface IAiChannelAdapter
{
    string ChannelType { get; }

    /// <summary>向指定外部用户发送文本（适配器自行处理分块/失败）。</summary>
    Task SendTextAsync(AiChannel channel, string externalId, string text, CancellationToken ct);

    /// <summary>连通性自检（设置页"测试连接"）。返回 (ok, message)。</summary>
    Task<(bool Ok, string Message)> TestAsync(AiChannel channel, CancellationToken ct);

    /// <summary>轮询型适配器拉取增量；非轮询型返回空批。</summary>
    Task<ChannelPollBatch> PollAsync(AiChannel channel, string? cursor, CancellationToken ct) =>
        Task.FromResult(new ChannelPollBatch { NewCursor = cursor });
}

/// <summary>iLink 会话过期（ret/errcode -14），需要重新扫码登录。</summary>
public sealed class SessionExpiredException : Exception
{
    public SessionExpiredException(string message) : base(message) { }
}

/// <summary>
/// Telegram Bot API 适配器（长轮询，无需公网回调地址）。
/// 出站：POST /bot{token}/sendMessage；入站：GET /bot{token}/getUpdates?timeout=30。
/// </summary>
public class TelegramChannelAdapter : IAiChannelAdapter
{
    private const string ApiBase = "https://api.telegram.org/bot{0}/";
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<TelegramChannelAdapter> _logger;

    public TelegramChannelAdapter(IHttpClientFactory httpFactory, ILogger<TelegramChannelAdapter> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
    }

    public string ChannelType => AiChannelTypes.Telegram;

    private HttpClient Client(string token)
    {
        var c = _httpFactory.CreateClient("ai-channel");
        c.Timeout = TimeSpan.FromSeconds(90); // 长轮询需放宽
        c.BaseAddress = new Uri(string.Format(ApiBase, token));
        return c;
    }

    private static string? Token(AiChannel ch) =>
        ch.Config.TryGetValue("botToken", out var t) && t.Length > 0 ? t : null;

    public async Task SendTextAsync(AiChannel channel, string externalId, string text, CancellationToken ct)
    {
        var token = Token(channel);
        if (token == null) throw new InvalidOperationException("Telegram botToken 未配置");
        var body = new JsonObject
        {
            ["chat_id"] = externalId,
            ["text"] = text,
            ["disable_web_page_preview"] = true,
        };
        var resp = await Client(token).PostAsJsonAsync("sendMessage", body, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Telegram sendMessage HTTP {(int)resp.StatusCode}: {err[..Math.Min(err.Length, 300)]}");
        }
    }

    public async Task<(bool Ok, string Message)> TestAsync(AiChannel channel, CancellationToken ct)
    {
        var token = Token(channel);
        if (token == null) return (false, "缺少 botToken");
        try
        {
            var resp = await Client(token).GetAsync("getMe", ct);
            if (!resp.IsSuccessStatusCode)
                return (false, $"HTTP {(int)resp.StatusCode}");
            var doc = JsonNode.Parse(await resp.Content.ReadAsStringAsync(ct));
            var uname = doc?["result"]?["username"]?.GetValue<string>() ?? "";
            return (true, $"@{uname}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public async Task<ChannelPollBatch> PollAsync(AiChannel channel, string? cursor, CancellationToken ct)
    {
        var token = Token(channel);
        if (token == null) return new ChannelPollBatch { NewCursor = cursor };
        var offset = long.TryParse(cursor, out var o) ? o : 0;
        var url = $"getUpdates?offset={offset}&timeout=30&allowed_updates=%5B%22message%22%5D";
        var resp = await Client(token).GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Telegram getUpdates HTTP {(int)resp.StatusCode}: {err[..Math.Min(err.Length, 200)]}");
        }
        var doc = JsonNode.Parse(await resp.Content.ReadAsStringAsync(ct)) as JsonObject;
        var ok = doc?["ok"]?.GetValue<bool>() ?? false;
        if (!ok)
        {
            var desc = doc?["description"]?.GetValue<string>() ?? "unknown error";
            throw new InvalidOperationException($"Telegram getUpdates failed: {desc}");
        }

        long newOffset = offset;
        var messages = new List<ChannelInboundMessage>();
        if (doc?["result"] is JsonArray arr)
        {
            foreach (var item in arr.OfType<JsonObject>())
            {
                var updateId = item["update_id"]?.GetValue<long>() ?? 0;
                // Telegram 确认语义：offset 必须推进到「最大已处理 update_id + 1」，
                // 服务端只重发 update_id >= offset 的更新——若只推进到 update_id 本身，
                // 同一条消息会被无限重复下发（表现为 bot 对一条消息反复响应）。
                if (updateId + 1 > newOffset) newOffset = updateId + 1;
                var msg = item["message"] as JsonObject;
                if (msg == null) continue;
                var text = msg["text"]?.GetValue<string>() ?? "";
                var chatId = msg["chat"]?["id"]?.GetValue<long>();
                if (chatId == null || text.Length == 0) continue;
                // 忽略机器人自己发出的消息（Telegram 不会回推，防御性跳过）。
                var isBot = msg["from"]?["is_bot"]?.GetValue<bool>() ?? false;
                if (isBot) continue;
                var from = msg["from"] as JsonObject;
                var firstName = from?["first_name"]?.GetValue<string>() ?? "";
                var lastName = from?["last_name"]?.GetValue<string>() ?? "";
                var uname = from?["username"]?.GetValue<string>() ?? "";
                var name = string.Join(' ', new[] { firstName, lastName }.Where(s => s.Length > 0));
                if (name.Length == 0) name = uname;
                if (name.Length == 0) name = chatId.ToString()!;
                messages.Add(new ChannelInboundMessage
                {
                    ChannelId = channel.Id,
                    ExternalId = chatId.ToString()!,
                    ExternalName = name,
                    Text = text,
                    // 幂等去重键（防御并发循环/重启重放导致的重复处理）。
                    DedupeKey = updateId.ToString(),
                });
            }
        }
        return new ChannelPollBatch { NewCursor = newOffset.ToString(), Messages = messages };
    }
}

/// <summary>
/// 飞书 Lark 适配器。
/// 入站两种形态（按频道配置 transport 选择，内网默认 websocket）：
///   - websocket：官方长连接（免公网回调），由 LarkWsChannelService 驱动，
///     本类负责 endpoint 引导与事件信封解析；
///   - webhook：事件订阅回调（challenge + Encrypt Key 验签/AES 解密），由
///     AiChannelWebhookController 转交 ParseWebhookAsync。
/// 出站：tenant_access_token → POST /open-apis/im/v1/messages?receive_id_type=open_id。
/// </summary>
public class LarkChannelAdapter : IAiChannelAdapter
{
    private const string Base = "https://open.feishu.cn/open-apis/";
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<LarkChannelAdapter> _logger;
    private readonly ConcurrentDictionary<string, (string Token, DateTime ExpiresAt)> _tokens = new();

    public LarkChannelAdapter(IHttpClientFactory httpFactory, ILogger<LarkChannelAdapter> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
    }

    public string ChannelType => AiChannelTypes.Lark;

    private HttpClient Client()
    {
        var c = _httpFactory.CreateClient("ai-channel");
        c.Timeout = TimeSpan.FromSeconds(30);
        c.BaseAddress = new Uri(Base);
        return c;
    }

    private static string? Get(AiChannel ch, string key) =>
        ch.Config.TryGetValue(key, out var v) && v.Length > 0 ? v : null;

    /// <summary>获取（并缓存）租户访问令牌。</summary>
    public async Task<string> GetTenantTokenAsync(AiChannel channel, CancellationToken ct)
    {
        var appId = Get(channel, "appId");
        var appSecret = Get(channel, "appSecret");
        if (appId == null || appSecret == null) throw new InvalidOperationException("Lark appId/appSecret 未配置");
        if (_tokens.TryGetValue(appId, out var cached) && cached.ExpiresAt > DateTime.UtcNow)
            return cached.Token;

        var resp = await Client().PostAsJsonAsync("auth/v3/tenant_access_token/internal",
            new JsonObject { ["app_id"] = appId, ["app_secret"] = appSecret }, ct);
        var doc = JsonNode.Parse(await resp.Content.ReadAsStringAsync(ct)) as JsonObject;
        if (!resp.IsSuccessStatusCode || (doc?["code"]?.GetValue<int>() ?? -1) != 0)
            throw new InvalidOperationException($"Lark tenant token failed: HTTP {(int)resp.StatusCode} {doc?["msg"]?.GetValue<string>()}");
        var token = doc!["tenant_access_token"]?.GetValue<string>() ?? "";
        var expire = doc["expire"]?.GetValue<int>() ?? 7200;
        _tokens[appId] = (token, DateTime.UtcNow.AddSeconds(Math.Max(60, expire - 1800)));
        return token;
    }

    /// <summary>
    /// 长连接引导：POST /callback/ws/endpoint（AppID/AppSecret 直接鉴权）。
    /// 返回 (wss 端点, 心跳间隔秒)。
    /// </summary>
    public async Task<(string Url, int PingIntervalSeconds)> FetchWsEndpointAsync(AiChannel channel, CancellationToken ct)
    {
        var appId = Get(channel, "appId");
        var appSecret = Get(channel, "appSecret");
        if (appId == null || appSecret == null) throw new InvalidOperationException("Lark appId/appSecret 未配置");
        var resp = await Client().PostAsJsonAsync("callback/ws/endpoint",
            new JsonObject { ["AppID"] = appId, ["AppSecret"] = appSecret }, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        var doc = JsonNode.Parse(body) as JsonObject;
        if (!resp.IsSuccessStatusCode || (doc?["code"]?.GetValue<int>() ?? -1) != 0)
            throw new InvalidOperationException($"Lark ws endpoint failed: code {doc?["code"]} msg {doc?["msg"]?.GetValue<string>()}");
        var url = doc?["data"]?["URL"]?.GetValue<string>() ?? "";
        if (url.Length == 0) throw new InvalidOperationException("Lark ws endpoint 响应缺少 URL");
        var ping = doc?["data"]?["ClientConfig"]?["PingInterval"]?.GetValue<int>() ?? 90;
        return (url, Math.Max(10, ping));
    }

    public async Task SendTextAsync(AiChannel channel, string externalId, string text, CancellationToken ct)
    {
        var token = await GetTenantTokenAsync(channel, ct);
        using var req = new HttpRequestMessage(HttpMethod.Post,
            "im/v1/messages?receive_id_type=" + (externalId.StartsWith("oc_", StringComparison.Ordinal) ? "chat_id" : "open_id"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Content = JsonContent.Create(new JsonObject
        {
            ["receive_id"] = externalId,
            ["msg_type"] = "text",
            ["content"] = new JsonObject { ["text"] = text }.ToJsonString(),
        });
        var resp = await Client().SendAsync(req, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        var code = JsonNode.Parse(body)?["code"]?.GetValue<int>() ?? -1;
        if (code != 0)
            throw new InvalidOperationException($"Lark sendMessage code {code}: {body[..Math.Min(body.Length, 300)]}");
    }

    public async Task<(bool Ok, string Message)> TestAsync(AiChannel channel, CancellationToken ct)
    {
        try
        {
            var token = await GetTenantTokenAsync(channel, ct);
            return (true, token.Length > 0 ? "token ok" : "empty token");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    /// <summary>
    /// 解析飞书事件回调（Webhook 模式，v2.0）：验签/解密 → 事件信封 → 入站消息。
    /// 返回 null 表示事件不需要处理（如机器人自身消息/URL 校验）。
    /// </summary>
    public async Task<ChannelInboundMessage?> ParseWebhookAsync(
        AiChannel channel, string rawBody, string? larkTimestamp, string? larkNonce, string? larkSignature, CancellationToken ct)
    {
        var encryptKey = Get(channel, "encryptKey");
        var bodyText = rawBody;

        // 加密载荷：{"encrypt": "base64"}，AES-256-CBC（key=SHA256(encryptKey)，iv=前16字节）。
        if (encryptKey != null && rawBody.TrimStart().StartsWith("{\"encrypt\"", StringComparison.Ordinal))
        {
            if (larkTimestamp == null || larkNonce == null || larkSignature == null)
                throw new InvalidOperationException("Lark encrypted event missing signature headers");
            var expected = Convert.ToBase64String(HMACSHA256.HashData(
                Encoding.UTF8.GetBytes(encryptKey),
                Encoding.UTF8.GetBytes($"{larkTimestamp}\n{larkNonce}\n{rawBody}")));
            if (!FixedTimeEquals(expected, larkSignature))
                throw new InvalidOperationException("Lark signature mismatch");
            var doc = JsonNode.Parse(rawBody) as JsonObject;
            var encrypted = doc?["encrypt"]?.GetValue<string>() ?? throw new InvalidOperationException("Lark encrypted payload missing");
            bodyText = DecryptLark(encryptKey, encrypted);
        }

        var root = JsonNode.Parse(bodyText) as JsonObject;
        if (root == null) return null;
        // 回调 URL 校验（订阅时飞书会发 challenge 请求）——由控制器处理，这里直接返回 null。
        if (root["challenge"] != null) return null;

        var verificationToken = Get(channel, "verificationToken");
        if (verificationToken != null)
        {
            var tok = root["header"]?["token"]?.GetValue<string>() ?? "";
            if (tok != verificationToken)
                throw new InvalidOperationException("Lark verification token mismatch");
        }

        return ParseEventEnvelope(channel, root);
    }

    /// <summary>
    /// 事件信封（{"schema":"2.0","header":{...},"event":{...}}）→ 入站消息。
    /// Webhook 与长连接共用。
    /// </summary>
    public ChannelInboundMessage? ParseEventEnvelope(AiChannel channel, JsonObject root)
    {
        var eventType = root["header"]?["event_type"]?.GetValue<string>() ?? "";
        if (eventType != "im.message.receive_v1") return null;
        var evt = root["event"] as JsonObject;
        if (evt == null) return null;

        var senderType = evt["sender"]?["sender_type"]?.GetValue<string>() ?? "";
        if (senderType != "user") return null; // 忽略机器人/系统消息
        var openId = evt["sender"]?["sender_id"]?["open_id"]?.GetValue<string>() ?? "";
        if (openId.Length == 0) return null;
        var msgType = evt["message"]?["message_type"]?.GetValue<string>() ?? "";
        if (msgType != "text") return null; // v1 只处理文本
        var content = evt["message"]?["content"]?.GetValue<string>() ?? "{}";
        var text = JsonNode.Parse(content)?["text"]?.GetValue<string>() ?? "";
        if (text.Length == 0) return null;
        var chatId = evt["message"]?["chat_id"]?.GetValue<string>() ?? "";
        var chatType = evt["message"]?["chat_type"]?.GetValue<string>() ?? "p2p";
        var name = evt["sender"]?["sender_id"]?["union_id"]?.GetValue<string>() ?? openId;

        return new ChannelInboundMessage
        {
            ChannelId = channel.Id,
            // 群聊回 chat_id，私聊回 open_id（SendTextAsync 按前缀选择 receive_id_type）。
            ExternalId = chatType == "p2p" ? openId : chatId,
            ExternalName = name,
            Text = text,
            // 飞书事件唯一 ID（WS 模式下事件未 ack 会被服务端重推，用它在入口去重）。
            DedupeKey = root["header"]?["event_id"]?.GetValue<string>(),
        };
    }

    private static string DecryptLark(string encryptKey, string encryptedB64)
    {
        var key = SHA256.HashData(Encoding.UTF8.GetBytes(encryptKey));
        var data = Convert.FromBase64String(encryptedB64);
        if (data.Length < 16) throw new InvalidOperationException("Lark encrypted payload too short");
        using var aes = Aes.Create();
        aes.Key = key;
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        using var dec = aes.CreateDecryptor(key, data[..16]);
        var plain = dec.TransformFinalBlock(data, 16, data.Length - 16);
        return Encoding.UTF8.GetString(plain);
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        var ba = Encoding.UTF8.GetBytes(a);
        var bb = Encoding.UTF8.GetBytes(b);
        return ba.Length == bb.Length && CryptographicOperations.FixedTimeEquals(ba, bb);
    }
}

/// <summary>
/// 微信 ClawBot 适配器——微信官方 iLink Bot API（HTTP/JSON）。
/// 参考 https://www.wechatbot.dev/zh/protocol （微信 ClawBot 背后协议，基座 https://ilinkai.weixin.qq.com）：
///   - 入站：POST /ilink/bot/getupdates 长轮询（~35s 挂起），get_updates_buf 为不透明游标；
///   - 出站：POST /ilink/bot/sendmessage，必须回传入站消息的 context_token（按用户缓存）；
///   - 鉴权：AuthorizationType: ilink_bot_token + Bearer bot_token + X-WECHAT-UIN + iLink-App-Id/ClientVersion；
///   - 会话过期：ret/errcode -14 → 需重新扫码登录（换 bot_token）。
/// bot_token 通过扫码登录获得（/ilink/bot/get_bot_qrcode → /get_qrcode_status 轮询），
/// 设置页"测试连接"会提示登录状态。
/// </summary>
public class WeChatClawAdapter : IAiChannelAdapter
{
    private const string DefaultBase = "https://ilinkai.weixin.qq.com";
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<WeChatClawAdapter> _logger;
    /// <summary>每用户 context_token 缓存（键 = channelId|externalId；会话过期时清除）。</summary>
    private readonly ConcurrentDictionary<string, string> _contextTokens = new();

    public WeChatClawAdapter(IHttpClientFactory httpFactory, ILogger<WeChatClawAdapter> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
    }

    public string ChannelType => AiChannelTypes.WechatClaw;

    private static string BaseUrl(AiChannel ch) =>
        ch.Config.TryGetValue("baseUrl", out var v) && v.Length > 0 ? v.TrimEnd('/') : DefaultBase;

    private static string? BotToken(AiChannel ch) =>
        ch.Config.TryGetValue("botToken", out var v) && v.Length > 0 ? v : null;

    private HttpClient Client()
    {
        var c = _httpFactory.CreateClient("ai-channel");
        c.Timeout = TimeSpan.FromSeconds(50); // getupdates 挂起 ~35s
        return c;
    }

    private static string RandomWechatUin()
    {
        // 随机 4 字节 → 大端 uint32 → 十进制字符串 → base64（与官方 SDK readUInt32BE 一致）。
        var b = RandomNumberGenerator.GetBytes(4);
        var value = BinaryPrimitives.ReadUInt32BigEndian(b);
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value.ToString()));
    }

    private HttpRequestMessage BuildRequest(AiChannel ch, string path, string jsonBody)
    {
        var token = BotToken(ch) ?? throw new InvalidOperationException("iLink botToken 未配置（需先完成扫码登录）");
        var req = new HttpRequestMessage(HttpMethod.Post, BaseUrl(ch) + path);
        req.Headers.Add("AuthorizationType", "ilink_bot_token");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Add("X-WECHAT-UIN", RandomWechatUin());
        req.Headers.Add("iLink-App-Id", "bot");
        req.Headers.Add("iLink-App-ClientVersion", "131072"); // channel_version 2.0.0 → 0x00020000
        req.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        return req;
    }

    private static string BaseInfo() =>
        "{\"channel_version\":\"2.0.0\",\"bot_agent\":\"Libra-Nextgen/1.0\"}";

    private static string Clip(string s) => s.Length > 300 ? s[..300] : s;

    public async Task SendTextAsync(AiChannel channel, string externalId, string text, CancellationToken ct)
    {
        var ctxKey = $"{channel.Id}|{externalId}";
        var ctx = _contextTokens.GetValueOrDefault(ctxKey);
        if (string.IsNullOrEmpty(ctx))
            throw new InvalidOperationException("iLink context_token 缺失（尚未收到该用户消息或会话已过期）");

        // 与官方 SDK buildTextMessagePayload 一致。
        var msg = new JsonObject
        {
            ["from_user_id"] = "",
            ["to_user_id"] = externalId,
            ["client_id"] = Guid.NewGuid().ToString(),
            ["message_type"] = 2,  // BOT
            ["message_state"] = 2, // FINISH
            ["context_token"] = ctx,
            ["item_list"] = new JsonArray
            {
                new JsonObject { ["type"] = 1, ["text_item"] = new JsonObject { ["text"] = text } },
            },
        };
        var body = new JsonObject { ["msg"] = msg, ["base_info"] = JsonNode.Parse(BaseInfo()) };

        var resp = await Client().SendAsync(BuildRequest(channel, "/ilink/bot/sendmessage", body.ToJsonString()), ct);
        var respBody = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"iLink sendmessage HTTP {(int)resp.StatusCode}: {Clip(respBody)}");
        var ret = JsonNode.Parse(respBody)?["ret"]?.GetValue<int>() ?? 0;
        if (ret == -14)
        {
            _contextTokens.TryRemove(ctxKey, out _);
            throw new SessionExpiredException("iLink 会话已过期，需要重新扫码登录");
        }
        if (ret != 0)
            throw new InvalidOperationException($"iLink sendmessage ret={ret}: {Clip(respBody)}");
    }

    public async Task<(bool Ok, string Message)> TestAsync(AiChannel channel, CancellationToken ct)
    {
        if (BotToken(channel) == null)
            return (false, "缺少 botToken（需先完成 iLink 扫码登录）");
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(15));
            await PollAsync(channel, "", cts.Token);
            return (true, "connected");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public async Task<ChannelPollBatch> PollAsync(AiChannel channel, string? cursor, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["get_updates_buf"] = cursor ?? "",
            ["base_info"] = JsonNode.Parse(BaseInfo()),
        };
        var resp = await Client().SendAsync(BuildRequest(channel, "/ilink/bot/getupdates", body.ToJsonString()), ct);
        var respBody = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"iLink getupdates HTTP {(int)resp.StatusCode}: {Clip(respBody)}");

        var doc = JsonNode.Parse(respBody) as JsonObject ?? new JsonObject();
        var ret = doc["ret"]?.GetValue<int>() ?? 0;
        if (ret == -14)
            throw new SessionExpiredException("iLink 会话已过期，需要重新扫码登录");
        if (ret != 0)
            throw new InvalidOperationException($"iLink getupdates ret={ret}: {Clip(respBody)}");

        var newCursor = doc["get_updates_buf"]?.GetValue<string>() ?? cursor ?? "";
        var messages = new List<ChannelInboundMessage>();
        if (doc["msgs"] is JsonArray msgs)
        {
            foreach (var m in msgs.OfType<JsonObject>())
            {
                if ((m["message_type"]?.GetValue<int>() ?? 0) != 1) continue; // 仅 USER 消息
                if ((m["message_state"]?.GetValue<int>() ?? 0) != 2) continue; // 仅 FINISH
                var from = m["from_user_id"]?.GetValue<string>() ?? "";
                if (from.Length == 0) continue;
                var ctx = m["context_token"]?.GetValue<string>() ?? "";
                if (ctx.Length > 0) _contextTokens[$"{channel.Id}|{from}"] = ctx;
                var text = ExtractText(m["item_list"] as JsonArray);
                if (text.Length == 0) continue;
                messages.Add(new ChannelInboundMessage
                {
                    ChannelId = channel.Id,
                    ExternalId = from,
                    ExternalName = from,
                    Text = text,
                    DedupeKey = m["message_id"]?.GetValue<long>().ToString(),
                });
            }
        }
        return new ChannelPollBatch { NewCursor = newCursor, Messages = messages };
    }

    private static string ExtractText(JsonArray? items)
    {
        if (items == null) return "";
        foreach (var item in items.OfType<JsonObject>())
        {
            if ((item["type"]?.GetValue<int>() ?? 0) != 1) continue; // TEXT item
            var t = item["text_item"]?["text"]?.GetValue<string>() ?? "";
            if (t.Length > 0) return t;
        }
        return "";
    }
}
