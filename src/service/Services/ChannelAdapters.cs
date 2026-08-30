using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LibraNextgen.Common.Models;
using Telegram.Bot;
using Telegram.Bot.Polling;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;
using Telegram.Bot.Types.ReplyMarkups;

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

    /// <summary>手写长轮询型频道（由 ChannelPollingHostedService 驱动；Telegram 改用 Telegram.Bot 库自带接收）。</summary>
    public static readonly string[] PollingTypes = { WechatClaw };
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

/// <summary>媒体消息（原生发送图片/视频/文件等；v1 支持 URL 形态）。</summary>
public sealed class ChannelMedia
{
    /// <summary>photo | video | document | audio | animation。</summary>
    public required string Type { get; init; }
    /// <summary>媒体文件 URL（http/https）。</summary>
    public required string Url { get; init; }
    public string? FileName { get; init; }
    public string? Caption { get; init; }
}

/// <summary>内联按钮审批回调（Telegram callback query 解析结果，频道无关）。</summary>
public sealed class CallbackAction
{
    public required string ChannelId { get; init; }
    public required string ExternalId { get; init; }
    public required string SessionId { get; init; }
    public required string ToolCallId { get; init; }
    public bool Approved { get; init; }
    /// <summary>one-time | 5min | 20min。</summary>
    public required string Permit { get; init; }
    /// <summary>回调回执所需（AnswerCallbackQuery / 编辑消息清按钮）。</summary>
    public required string CallbackQueryId { get; init; }
    public required string ChatId { get; init; }
    public int MessageId { get; init; }
}

public sealed class CallbackResult
{
    public bool Ok { get; init; }
    public string? Message { get; init; }
    public CallbackResult(bool ok, string? message = null)
    {
        Ok = ok;
        Message = message;
    }
}

/// <summary>AI 频道适配器统一抽象。入站形态：长轮询（PollAsync）、库回调（Telegram）、Webhook/长连接（解析函数）。</summary>
public interface IAiChannelAdapter
{
    string ChannelType { get; }

    /// <summary>向指定外部用户发送文本（适配器自行处理分块/失败）。</summary>
    Task SendTextAsync(AiChannel channel, string externalId, string text, CancellationToken ct);

    /// <summary>发送媒体（图片/视频/文件等）。默认降级为发送 URL 文本。</summary>
    Task SendMediaAsync(AiChannel channel, string externalId, ChannelMedia media, CancellationToken ct) =>
        SendTextAsync(channel, externalId, string.IsNullOrEmpty(media.Caption) ? media.Url : $"{media.Caption}\n{media.Url}", ct);

    /// <summary>
    /// 发送审批请求（带操作按钮的频道原生实现，如 Telegram 内联键盘）。
    /// html/plain 双版本：支持富文本的频道渲染 html（含按钮），其余发 plain。
    /// 默认降级为纯文本（其他频道现状：IM 内 /approve /reject 命令）。
    /// </summary>
    Task SendApprovalAsync(AiChannel channel, string externalId, string html, string plain, string sessionId, string toolCallId, CancellationToken ct) =>
        SendTextAsync(channel, externalId, plain, ct);

    /// <summary>连通性自检（设置页"测试连接"）。返回 (ok, message)。</summary>
    Task<(bool Ok, string Message)> TestAsync(AiChannel channel, CancellationToken ct);

    /// <summary>是否支持富文本（HTML 解析模式）。Telegram 支持；其余频道回退纯文本。</summary>
    bool SupportsRichText => false;

    /// <summary>
    /// 发送富文本消息：html 供支持 Markdown 的频道渲染，plain 供其他频道。
    /// 调用方保证 html 内容已做 HTML 转义（用户输入不可信）。
    /// </summary>
    Task SendRichTextAsync(AiChannel channel, string externalId, string html, string plain, CancellationToken ct) =>
        SendTextAsync(channel, externalId, plain, ct);

    /// <summary>
    /// 流式输出：发送首条消息并返回消息 ID（用于后续编辑更新）。
    /// 返回 0 表示该频道不支持流式（调用方回退一次性输出）。
    /// </summary>
    Task<long> StartStreamAsync(AiChannel channel, string externalId, string text, CancellationToken ct) =>
        Task.FromResult(0L);

    /// <summary>流式输出：编辑已发送的消息为最新文本（StartStreamAsync 返回非 0 时调用）。</summary>
    Task UpdateStreamAsync(AiChannel channel, string externalId, long messageId, string text, CancellationToken ct) =>
        Task.CompletedTask;

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
/// Telegram 适配器——基于官方 Telegram.Bot（.NET）库，不手写 HTTP/轮询。
/// 入站：StartReceiving 长轮询回调（库内部管理 offset，无需公网回调）；
/// 出站：SendTextMessageAsync / SendPhotoAsync / SendDocumentAsync 等原生 API；
/// 审批：InlineKeyboardMarkup 内联按钮（批准 / 临时批准 5min / 20min / 拒绝），
///       callback data 用短令牌（Telegram 上限 64 字节），点击经 CallbackQuery 回执。
/// </summary>
public class TelegramChannelAdapter : IAiChannelAdapter
{
    private readonly ILogger<TelegramChannelAdapter> _logger;
    /// <summary>channelId → bot client（每频道一个；Token 变化时旧 client 失效由轮询重启兜底）。</summary>
    private readonly ConcurrentDictionary<string, ITelegramBotClient> _clients = new();
    /// <summary>审批按钮令牌表：token → 审批上下文（TTL 10 分钟）。</summary>
    private readonly ConcurrentDictionary<string, ApprovalButton> _approvalButtons = new();

    public TelegramChannelAdapter(ILogger<TelegramChannelAdapter> logger)
    {
        _logger = logger;
    }

    public string ChannelType => AiChannelTypes.Telegram;

    /// <summary>Telegram 支持 HTML 解析模式（宽松免转义，仅需调用方转义用户输入）。</summary>
    public bool SupportsRichText => true;

    private static string? Token(AiChannel ch) =>
        ch.Config.TryGetValue("botToken", out var t) && t.Length > 0 ? t : null;

    private ITelegramBotClient Bot(AiChannel ch)
    {
        var token = Token(ch) ?? throw new InvalidOperationException("Telegram botToken 未配置");
        return _clients.GetOrAdd(ch.Id, _ => new TelegramBotClient(token) { Timeout = TimeSpan.FromSeconds(60) });
    }

    public async Task SendTextAsync(AiChannel channel, string externalId, string text, CancellationToken ct)
    {
        await Bot(channel).SendMessage(externalId, text, cancellationToken: ct);
    }

    /// <summary>富文本：HTML 解析模式（调用方负责转义用户输入）。</summary>
    public async Task SendRichTextAsync(AiChannel channel, string externalId, string html, string plain, CancellationToken ct)
    {
        try
        {
            await Bot(channel).SendMessage(externalId, html, parseMode: ParseMode.Html, cancellationToken: ct);
        }
        catch (Exception)
        {
            // HTML 渲染失败（如非法标签）：回退纯文本，保证消息必达。
            await Bot(channel).SendMessage(externalId, plain, cancellationToken: ct);
        }
    }

    public async Task SendMediaAsync(AiChannel channel, string externalId, ChannelMedia media, CancellationToken ct)
    {
        var bot = Bot(channel);
        var file = InputFile.FromUri(media.Url);
        switch (media.Type)
        {
            case "photo":
                await bot.SendPhoto(externalId, file, caption: media.Caption, cancellationToken: ct);
                break;
            case "video":
                await bot.SendVideo(externalId, file, caption: media.Caption, cancellationToken: ct);
                break;
            case "audio":
                await bot.SendAudio(externalId, file, caption: media.Caption, cancellationToken: ct);
                break;
            case "animation":
                await bot.SendAnimation(externalId, file, caption: media.Caption, cancellationToken: ct);
                break;
            default:
                // fileName 由 URL/文件名推断（22.x 的 InputFile 自带文件名）。
                await bot.SendDocument(externalId, file, caption: media.Caption, cancellationToken: ct);
                break;
        }
    }

    /// <summary>发送审批请求：HTML 富文本 + 内联按钮（批准 / 5min / 20min / 拒绝）；失败回退纯文本。</summary>
    public async Task SendApprovalAsync(AiChannel channel, string externalId, string html, string plain, string sessionId, string toolCallId, CancellationToken ct)
    {
        var markup = BuildApprovalMarkup(channel.Id, externalId, sessionId, toolCallId);
        try
        {
            await Bot(channel).SendMessage(externalId, html, parseMode: ParseMode.Html, replyMarkup: markup, cancellationToken: ct);
        }
        catch (Exception)
        {
            await Bot(channel).SendMessage(externalId, plain, replyMarkup: markup, cancellationToken: ct);
        }
    }

    /// <summary>流式输出：发送首条消息，返回 message id 供后续编辑。</summary>
    public async Task<long> StartStreamAsync(AiChannel channel, string externalId, string text, CancellationToken ct)
    {
        var sent = await Bot(channel).SendMessage(externalId, text, cancellationToken: ct);
        return sent.Id;
    }

    /// <summary>流式输出：编辑消息为最新文本。</summary>
    public async Task UpdateStreamAsync(AiChannel channel, string externalId, long messageId, string text, CancellationToken ct)
    {
        await Bot(channel).EditMessageText(externalId, (int)messageId, text, cancellationToken: ct);
    }

    /// <summary>
    /// 构造审批内联键盘。按钮 callback data 使用短令牌（Telegram 上限 64 字节）：
    ///   ap:&lt;token&gt;[:ot|5m|20m] 批准；rj:&lt;token&gt; 拒绝。
    /// </summary>
    public InlineKeyboardMarkup BuildApprovalMarkup(string channelId, string externalId, string sessionId, string toolCallId)
    {
        var token = CreateApprovalToken(channelId, externalId, sessionId, toolCallId);
        return new InlineKeyboardMarkup(new[]
        {
            new[]
            {
                InlineKeyboardButton.WithCallbackData("✅ 批准", $"ap:{token}:ot"),
                InlineKeyboardButton.WithCallbackData("⏱ 5 分钟", $"ap:{token}:5m"),
                InlineKeyboardButton.WithCallbackData("⏱ 20 分钟", $"ap:{token}:20m"),
            },
            new[]
            {
                InlineKeyboardButton.WithCallbackData("❌ 拒绝", $"rj:{token}"),
            },
        });
    }

    /// <summary>生成审批令牌并登记（TTL 10 分钟）。</summary>
    public string CreateApprovalToken(string channelId, string externalId, string sessionId, string toolCallId)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
        _approvalButtons[token] = new ApprovalButton
        {
            ChannelId = channelId,
            ExternalId = externalId,
            SessionId = sessionId,
            ToolCallId = toolCallId,
            ExpiresAt = DateTime.UtcNow.AddMinutes(10),
        };
        return token;
    }

    /// <summary>
    /// 解析按钮回调：校验令牌存在、未过期、归属（externalId = 消息 chat_id）。
    /// 返回 null 表示按钮无效（已过期/不属于该用户）。
    /// </summary>
    public CallbackAction? ResolveCallback(AiChannel channel, CallbackQuery cq)
    {
        if (cq.Data is not { } data || cq.Message is not { } msg) return null;
        if (cq.Id.Length == 0) return null;

        var approved = data.StartsWith("ap:", StringComparison.Ordinal);
        var rejected = data.StartsWith("rj:", StringComparison.Ordinal);
        if (!approved && !rejected) return null;

        var parts = data.Split(':');
        if (parts.Length < 2) return null;
        var token = parts[1];
        if (!_approvalButtons.TryGetValue(token, out var btn)) return null;
        if (btn.ExpiresAt < DateTime.UtcNow)
        {
            _approvalButtons.TryRemove(token, out _);
            return null;
        }
        // 归属校验：按钮只能被发起对话的外部用户点击（私聊 chat_id == 用户 id）。
        var chatId = msg.Chat.Id.ToString();
        if (btn.ChannelId != channel.Id || btn.ExternalId != chatId) return null;

        var permit = "one-time";
        if (approved && parts.Length > 2)
        {
            permit = parts[2] switch
            {
                "5m" => "5min",
                "20m" => "20min",
                _ => "one-time",
            };
        }
        return new CallbackAction
        {
            ChannelId = channel.Id,
            ExternalId = btn.ExternalId,
            SessionId = btn.SessionId,
            ToolCallId = btn.ToolCallId,
            Approved = approved,
            Permit = permit,
            CallbackQueryId = cq.Id,
            ChatId = chatId,
            MessageId = msg.MessageId,
        };
    }

    public async Task<(bool Ok, string Message)> TestAsync(AiChannel channel, CancellationToken ct)
    {
        var token = Token(channel);
        if (token == null) return (false, "缺少 botToken");
        try
        {
            var me = await Bot(channel).GetMe(ct);
            return (true, $"@{me.Username}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    /// <summary>
    /// 启动库驱动的长轮询接收（每频道一次，由 TelegramBotHostedService 调用）。
    /// onInbound：文本消息入站；onCallback：审批按钮回调（返回回执结果）。
    /// </summary>
    public Task StartReceivingAsync(
        AiChannel channel,
        Func<ChannelInboundMessage, CancellationToken, Task> onInbound,
        Func<CallbackAction, CancellationToken, Task<CallbackResult>> onCallback,
        CancellationToken ct)
    {
        var bot = Bot(channel);
        _logger.LogInformation("Telegram StartReceiving (channel {Channel})", channel.Id);
        bot.StartReceiving(
            async (b, update, c) =>
            {
                // 诊断：每个到达的更新先记类型（排查用；正常运行时保持 Debug）。
                _logger.LogDebug("Telegram update {UpdateId} type={Type}", update.Id,
                    update.CallbackQuery != null ? "callback_query"
                    : update.Message != null ? "message"
                    : update.Type.ToString());
                try
                {
                    await HandleUpdateAsync(channel, b, update, onInbound, onCallback, c);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Telegram update handling failed (channel {Channel}, update {UpdateId})", channel.Id, update.Id);
                }
            },
            (b, ex, c) =>
            {
                if (ex is not OperationCanceledException)
                    _logger.LogWarning(ex, "Telegram receive error (channel {Channel})", channel.Id);
                return Task.CompletedTask;
            },
            new ReceiverOptions
            {
                // null = 接收全部更新类型（handler 只处理 Message/CallbackQuery，其余忽略）。
                AllowedUpdates = null,
            },
            ct);
        return Task.CompletedTask;
    }

    private async Task HandleUpdateAsync(
        AiChannel channel, ITelegramBotClient bot, Update update,
        Func<ChannelInboundMessage, CancellationToken, Task> onInbound,
        Func<CallbackAction, CancellationToken, Task<CallbackResult>> onCallback,
        CancellationToken ct)
    {
        if (update.Message is { } msg)
        {
            var inbound = TryParseMessage(channel, msg);
            if (inbound != null)
            {
                // 关键：消息处理（RunChatAsync 可能因审批挂起阻塞很久）绝不能阻塞
                // Telegram 接收循环——否则后续更新（含按钮回调）全部积压无响应。
                // per-user 并发闸 + 限流在 AiChannelService 内保证串行与安全。
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await onInbound(inbound, ct);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Telegram inbound handling failed (channel {Channel})", channel.Id);
                    }
                }, ct);
            }
            return;
        }
        if (update.CallbackQuery is { } cq)
        {
            var action = ResolveCallback(channel, cq);
            if (action == null)
            {
                _logger.LogDebug("Telegram callback rejected (channel {Channel}, data '{Data}')", channel.Id, cq.Data);
                await bot.AnswerCallbackQuery(cq.Id, "按钮已失效，请在对话中重新发起审批", showAlert: false, cancellationToken: ct);
                return;
            }
            // 异步处理：审批续跑（工具执行）可能耗时，同样不阻塞接收循环。
            _ = Task.Run(async () =>
            {
                try
                {
                    var result = await onCallback(action, ct);
                    _logger.LogInformation("Telegram callback resolved (channel {Channel}, approved={Approved}, permit={Permit}, session={Session})",
                        channel.Id, action.Approved, action.Permit, action.SessionId);
                    await bot.AnswerCallbackQuery(action.CallbackQueryId,
                        result.Ok ? (action.Approved ? $"✅ 已批准（{action.Permit}）" : "❌ 已拒绝") : result.Message,
                        showAlert: !result.Ok, cancellationToken: ct);
                    // 按钮已处理：移除键盘，避免重复点击。
                    try
                    {
                        await bot.EditMessageReplyMarkup(action.ChatId, action.MessageId, replyMarkup: null, cancellationToken: ct);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogDebug(ex, "Failed to clear approval keyboard (message {MessageId})", action.MessageId);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Telegram callback handling failed (channel {Channel})", channel.Id);
                }
            }, ct);
        }
    }

    /// <summary>把 Telegram 文本消息规范化为入站消息（纯函数，可测试）。</summary>
    public static ChannelInboundMessage? TryParseMessage(AiChannel channel, Message msg)
    {
        if (string.IsNullOrWhiteSpace(msg.Text) || msg.Chat?.Id == null) return null;
        // 忽略机器人自己的消息（防御性）。
        if (msg.From?.IsBot == true) return null;
        var chatId = msg.Chat.Id.ToString()!;
        var name = string.Join(' ', new[] { msg.From?.FirstName, msg.From?.LastName }.Where(s => !string.IsNullOrEmpty(s)));
        if (string.IsNullOrEmpty(name)) name = msg.From?.Username ?? chatId;
        return new ChannelInboundMessage
        {
            ChannelId = channel.Id,
            ExternalId = chatId,
            ExternalName = name,
            Text = msg.Text,
            // 幂等去重键：message_id 在单个 chat 内唯一，配合入站去重防御重放。
            DedupeKey = msg.MessageId.ToString(),
        };
    }
}

/// <summary>审批按钮令牌上下文（Telegram callback data 短令牌映射）。</summary>
public sealed class ApprovalButton
{
    public required string ChannelId { get; init; }
    public required string ExternalId { get; init; }
    public required string SessionId { get; init; }
    public required string ToolCallId { get; init; }
    public DateTime ExpiresAt { get; init; }
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
