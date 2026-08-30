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
    /// <summary>频道侧身份 ID（绑定/会话/权限键）：私聊 = chat id；群组 = 发送者 from id。</summary>
    public required string ExternalId { get; init; }
    /// <summary>回复目标（发送地址）：群组 = 群 chat id；私聊 = null（用 ExternalId）。</summary>
    public string? ReplyTo { get; init; }
    public string ExternalName { get; init; } = "";
    public required string Text { get; init; }
    /// <summary>
    /// 幂等去重键（Telegram update_id / 飞书 event_id / iLink message_id）。
    /// 非空时由 AiChannelService 在入站管线入口去重，防御并发循环 / 重启重放。
    /// </summary>
    public string? DedupeKey { get; init; }
    /// <summary>原始消息 ID（Telegram message id；搜索词等场景用于删除用户消息）。</summary>
    public long? OriginMessageId { get; init; }
    /// <summary>消息是否来自群组（群组权限过滤用：仅已绑定账户 + @提及）。</summary>
    public bool IsGroup { get; init; }
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
    /// <summary>身份 ID（群组 = 点击者 from id；私聊 = chat id）。</summary>
    public required string ExternalId { get; init; }
    public required string SessionId { get; init; }
    public required string ToolCallId { get; init; }
    public bool Approved { get; init; }
    /// <summary>one-time | 5min | 20min。</summary>
    public required string Permit { get; init; }
    /// <summary>回调回执所需（AnswerCallbackQuery / 编辑消息清按钮）。</summary>
    public required string CallbackQueryId { get; init; }
    /// <summary>发送目标（回复地址；群组 = 群 chat id）。</summary>
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

/// <summary>频道菜单按钮回调（模型分页/选择/搜索、档位切换），频道无关。</summary>
public sealed class ChannelMenuAction
{
    /// <summary>model-nav | model-select | model-search | tier-select | help-* | model-*。</summary>
    public required string Kind { get; init; }
    public required string ChannelId { get; init; }
    /// <summary>身份 ID（群组 = 点击者 from id；私聊 = chat id）。</summary>
    public required string ExternalId { get; init; }
    /// <summary>发送目标（回复地址；群组 = 群 chat id）。</summary>
    public required string ChatId { get; init; }
    public required string CallbackQueryId { get; init; }
    public int MessageId { get; init; }
    /// <summary>model-nav: 页码；model-select: 索引；tier-select: 档位 0-3。</summary>
    public string? Data { get; init; }
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

    /// <summary>
    /// 审批决策完成后删除审批消息（用户已批准/拒绝，无需保留）。
    /// 仅支持原生按钮的频道实现；默认 no-op。
    /// </summary>
    Task DeleteApprovalMessageAsync(AiChannel channel, string sessionId, string toolCallId, CancellationToken ct) =>
        Task.CompletedTask;

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
    /// 删除一条消息（搜索词场景：删除用户发送的搜索关键词消息）。
    /// 默认 no-op（仅 Telegram 支持）。
    /// </summary>
    Task<bool> DeleteMessageAsync(AiChannel channel, string externalId, long messageId, CancellationToken ct) =>
        Task.FromResult(false);

    /// <summary>获取 bot 用户名（深链绑定 t.me/{username}?start=CODE 用）。默认空。</summary>
    Task<string> GetBotUsernameAsync(AiChannel channel, CancellationToken ct) =>
        Task.FromResult("");

    /// <summary>
    /// 发送带自定义键盘的消息（聊天框下方常驻按钮，点击发送按钮文本）。
    /// 默认 no-op（仅 Telegram 支持）。
    /// </summary>
    Task SendKeyboardAsync(AiChannel channel, string externalId, string html, string plain, IReadOnlyList<string> buttons, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>
    /// 流式输出：发送首条消息并返回消息 ID（用于后续编辑更新）。
    /// 返回 0 表示该频道不支持流式（调用方回退一次性输出）。
    /// </summary>
    Task<long> StartStreamAsync(AiChannel channel, string externalId, string text, CancellationToken ct) =>
        Task.FromResult(0L);

    /// <summary>流式输出：编辑已发送的消息为最新文本（StartStreamAsync 返回非 0 时调用）。</summary>
    Task UpdateStreamAsync(AiChannel channel, string externalId, long messageId, string text, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>
    /// 发送菜单按钮消息（模型选择/档位切换等内联菜单）。
    /// rows：行结构（每行一组按钮，同行按钮并排显示）。
    /// 返回消息 ID（0 = 频道不支持菜单，调用方回退纯文本）。
    /// </summary>
    Task<long> SendMenuAsync(AiChannel channel, string externalId, string html, string plain, IReadOnlyList<IReadOnlyList<(string Text, string Data)>> rows, CancellationToken ct) =>
        Task.FromResult(0L);

    /// <summary>编辑菜单消息（翻页/搜索/选择后更新）。rows 为 null 表示清空按钮。返回是否成功。</summary>
    Task<bool> EditMenuAsync(AiChannel channel, string chatId, long messageId, string html, string plain, IReadOnlyList<IReadOnlyList<(string Text, string Data)>>? rows, CancellationToken ct) =>
        Task.FromResult(false);

    /// <summary>轮询型适配器拉取增量；非轮询型返回空批。</summary>
    Task<ChannelPollBatch> PollAsync(AiChannel channel, string? cursor, CancellationToken ct) =>
        Task.FromResult(new ChannelPollBatch { NewCursor = cursor });
}

/// <summary>微信 iLink 扫码状态轮询结果。</summary>
public sealed class WeChatQrStatusResult
{
    /// <summary>wait | scaned | confirmed | expired。</summary>
    public string Status { get; init; } = "wait";
    /// <summary>confirmed 时返回的 bot_token（仅此一次响应可见）。</summary>
    public string? BotToken { get; init; }
    /// <summary>confirmed 时返回的 bot 账号 ID（…@im.bot）。</summary>
    public string? ILinkBotId { get; init; }
    /// <summary>confirmed 时返回的业务基座地址（与默认一致时可为空）。</summary>
    public string? BaseUrl { get; init; }
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
    /// <summary>待删除的审批消息：sessionId:toolCallId → (chatId, messageId)。决策完成后删除。</summary>
    private readonly ConcurrentDictionary<string, (string ChatId, int MessageId)> _pendingApprovalMessages = new();

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

    /// <summary>删除一条消息（搜索关键词等场景）。</summary>
    public async Task<bool> DeleteMessageAsync(AiChannel channel, string externalId, long messageId, CancellationToken ct)
    {
        try
        {
            await Bot(channel).DeleteMessage(externalId, (int)messageId, ct);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to delete message {MessageId}", messageId);
            return false;
        }
    }

    /// <summary>发送带自定义键盘的消息（聊天框下方常驻按钮；按钮点击即发送其文本）。</summary>
    public async Task SendKeyboardAsync(AiChannel channel, string externalId, string html, string plain, IReadOnlyList<string> buttons, CancellationToken ct)
    {
        var keyboard = new ReplyKeyboardMarkup(buttons.Select(b => new[] { new KeyboardButton(b) }))
        {
            ResizeKeyboard = true,
        };
        try
        {
            await Bot(channel).SendMessage(externalId, html, parseMode: ParseMode.Html, replyMarkup: keyboard, cancellationToken: ct);
        }
        catch (Exception)
        {
            await Bot(channel).SendMessage(externalId, plain, replyMarkup: keyboard, cancellationToken: ct);
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
        Message sent;
        try
        {
            sent = await Bot(channel).SendMessage(externalId, html, parseMode: ParseMode.Html, replyMarkup: markup, cancellationToken: ct);
        }
        catch (Exception)
        {
            sent = await Bot(channel).SendMessage(externalId, plain, replyMarkup: markup, cancellationToken: ct);
        }
        // 记录审批消息：决策完成后据此删除。
        _pendingApprovalMessages[$"{sessionId}:{toolCallId}"] = (externalId, sent.Id);
    }

    /// <summary>审批决策完成：删除审批消息（用户已批准/拒绝，无需保留）。</summary>
    public async Task DeleteApprovalMessageAsync(AiChannel channel, string sessionId, string toolCallId, CancellationToken ct)
    {
        var key = $"{sessionId}:{toolCallId}";
        if (!_pendingApprovalMessages.TryRemove(key, out var m)) return;
        try
        {
            await Bot(channel).DeleteMessage(m.ChatId, m.MessageId, ct);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to delete approval message {MessageId} (session {Session})", m.MessageId, sessionId);
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

    /// <summary>发送内联菜单消息（模型/档位选择；rows 行结构，同行按钮并排）。</summary>
    public async Task<long> SendMenuAsync(AiChannel channel, string externalId, string html, string plain, IReadOnlyList<IReadOnlyList<(string Text, string Data)>> rows, CancellationToken ct)
    {
        var markup = BuildMenuMarkup(rows);
        Message sent;
        try
        {
            sent = await Bot(channel).SendMessage(externalId, html, parseMode: ParseMode.Html, replyMarkup: markup, cancellationToken: ct);
        }
        catch (Exception)
        {
            sent = await Bot(channel).SendMessage(externalId, plain, replyMarkup: markup, cancellationToken: ct);
        }
        return sent.Id;
    }

    /// <summary>编辑内联菜单消息（翻页/搜索/选择后更新；rows 为 null 清空按钮）。</summary>
    public async Task<bool> EditMenuAsync(AiChannel channel, string chatId, long messageId, string html, string plain, IReadOnlyList<IReadOnlyList<(string Text, string Data)>>? rows, CancellationToken ct)
    {
        var markup = rows == null ? null : BuildMenuMarkup(rows);
        try
        {
            await Bot(channel).EditMessageText(chatId, (int)messageId, html, parseMode: ParseMode.Html, replyMarkup: markup, cancellationToken: ct);
            return true;
        }
        catch (Exception)
        {
            try
            {
                await Bot(channel).EditMessageText(chatId, (int)messageId, plain, replyMarkup: markup, cancellationToken: ct);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Menu edit failed (message {MessageId})", messageId);
                return false;
            }
        }
    }

    /// <summary>行结构 → InlineKeyboardMarkup（同一行的按钮并排显示）。</summary>
    private static InlineKeyboardMarkup BuildMenuMarkup(IReadOnlyList<IReadOnlyList<(string Text, string Data)>> rows) =>
        new(rows.Select(row => row.Select(b => InlineKeyboardButton.WithCallbackData(b.Text, b.Data)).ToArray()));

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
        // 归属校验：按钮只能被发起对话的外部用户点击（群组按 from.id，私聊 chat_id == from id）。
        var identityId = cq.From?.Id.ToString() ?? msg.Chat.Id.ToString();
        if (btn.ChannelId != channel.Id || btn.ExternalId != identityId) return null;

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
            ChatId = msg.Chat.Id.ToString(),
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
    /// onInbound：文本消息入站；onCallback：审批按钮回调（返回回执结果）；
    /// onMenuCallback：菜单按钮回调（模型/档位）。启动时同步 bot 指令列表（setMyCommands）。
    /// </summary>
    public async Task StartReceivingAsync(
        AiChannel channel,
        Func<ChannelInboundMessage, CancellationToken, Task> onInbound,
        Func<CallbackAction, CancellationToken, Task<CallbackResult>> onCallback,
        Func<ChannelMenuAction, CancellationToken, Task> onMenuCallback,
        CancellationToken ct)
    {
        var bot = Bot(channel);
        // 每次连接都同步指令列表（聊天输入框 "/" 菜单）。
        try
        {
            await bot.SetMyCommands(BotCommands, cancellationToken: ct);
            _logger.LogInformation("Telegram commands synced (channel {Channel})", channel.Id);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to sync Telegram commands (channel {Channel})", channel.Id);
        }
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
                    await HandleUpdateAsync(channel, b, update, onInbound, onCallback, onMenuCallback, c);
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
    }

    /// <summary>Bot 菜单指令（聊天输入框 "/" 可见，每次连接同步）。</summary>
    private static readonly BotCommand[] BotCommands =
    {
        new() { Command = "start", Description = "开始使用" },
        new() { Command = "help", Description = "显示帮助" },
        new() { Command = "status", Description = "查看绑定与档位" },
        new() { Command = "bind", Description = "绑定控制台账号" },
        new() { Command = "model", Description = "切换模型" },
        new() { Command = "tier", Description = "切换档位" },
    };

    /// <summary>channelId → bot username（群组 @提及 判断用，惰性获取并缓存）。</summary>
    private readonly ConcurrentDictionary<string, string> _botUsernames = new();

    private async Task<string> EnsureBotUsernameAsync(AiChannel channel, CancellationToken ct)
    {
        if (_botUsernames.TryGetValue(channel.Id, out var u)) return u;
        try
        {
            var me = await Bot(channel).GetMe(ct);
            u = me.Username ?? "";
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to resolve bot username (channel {Channel})", channel.Id);
            u = "";
        }
        _botUsernames[channel.Id] = u;
        return u;
    }

    /// <summary>获取 bot 用户名（深链绑定链接用；惰性获取并缓存）。</summary>
    public Task<string> GetBotUsernameAsync(AiChannel channel, CancellationToken ct) =>
        EnsureBotUsernameAsync(channel, ct);

    private async Task HandleUpdateAsync(
        AiChannel channel, ITelegramBotClient bot, Update update,
        Func<ChannelInboundMessage, CancellationToken, Task> onInbound,
        Func<CallbackAction, CancellationToken, Task<CallbackResult>> onCallback,
        Func<ChannelMenuAction, CancellationToken, Task> onMenuCallback,
        CancellationToken ct)
    {
        if (update.Message is { } msg)
        {
            var botUsername = await EnsureBotUsernameAsync(channel, ct);
            var inbound = TryParseMessage(channel, msg, botUsername);
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
            // 审批按钮优先。
            var action = ResolveCallback(channel, cq);
            if (action != null)
            {
                HandleApprovalCallbackAsync(channel, bot, action, onCallback, ct);
                return;
            }
            // 菜单按钮（模型/档位/帮助快捷）。
            var menu = TryResolveMenu(channel, cq);
            if (menu != null)
            {
                // 先回执（避免按钮转圈），再异步处理。
                _ = bot.AnswerCallbackQuery(cq.Id, cancellationToken: ct);
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await onMenuCallback(menu, ct);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Telegram menu callback handling failed (channel {Channel})", channel.Id);
                    }
                }, ct);
                return;
            }
            _logger.LogDebug("Telegram callback rejected (channel {Channel}, data '{Data}')", channel.Id, cq.Data);
            await bot.AnswerCallbackQuery(cq.Id, "按钮已失效，请在对话中重新发起审批", showAlert: false, cancellationToken: ct);
        }
    }

    private void HandleApprovalCallbackAsync(
        AiChannel channel, ITelegramBotClient bot, CallbackAction action,
        Func<CallbackAction, CancellationToken, Task<CallbackResult>> onCallback, CancellationToken ct)
    {
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
                if (result.Ok)
                {
                    // 决策完成：删除审批消息（用户已批准/拒绝，无需保留）。
                    try
                    {
                        await bot.DeleteMessage(action.ChatId, action.MessageId, ct);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogDebug(ex, "Failed to delete approval message (message {MessageId})", action.MessageId);
                    }
                    _pendingApprovalMessages.TryRemove($"{action.SessionId}:{action.ToolCallId}", out _);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Telegram callback handling failed (channel {Channel})", channel.Id);
            }
        }, ct);
    }

    /// <summary>
    /// 解析菜单按钮回调（模型供应商/分页/选择/搜索、档位切换、帮助快捷与返回）。
    /// 返回 null 表示不是菜单按钮。
    /// 前缀：mdl:prov:idx / mdl:provs / mdl:nav:页 / mdl:sel:idx / mdl:sea / mdl:back /
    ///       tier:sel:档位 / help:model|tier|status|back。
    /// </summary>
    public ChannelMenuAction? TryResolveMenu(AiChannel channel, CallbackQuery cq)
    {
        if (cq.Data is not { } data || cq.Message is not { } msg || cq.Id.Length == 0) return null;
        var chatId = msg.Chat.Id.ToString();
        string? kind = null, payload = null;
        if (data.StartsWith("mdl:nav:", StringComparison.Ordinal))
        {
            kind = "model-nav";
            payload = data["mdl:nav:".Length..];
        }
        else if (data.StartsWith("mdl:sel:", StringComparison.Ordinal))
        {
            kind = "model-select";
            payload = data["mdl:sel:".Length..];
        }
        else if (data.StartsWith("mdl:prov:", StringComparison.Ordinal))
        {
            kind = "model-provider";
            payload = data["mdl:prov:".Length..];
        }
        else if (data == "mdl:provs")
        {
            kind = "model-providers";
        }
        else if (data == "mdl:sea")
        {
            kind = "model-search";
        }
        else if (data == "mdl:back")
        {
            kind = "model-back";
        }
        else if (data.StartsWith("tier:sel:", StringComparison.Ordinal))
        {
            kind = "tier-select";
            payload = data["tier:sel:".Length..];
        }
        else if (data == "help:model")
        {
            kind = "help-model";
        }
        else if (data == "help:tier")
        {
            kind = "help-tier";
        }
        else if (data == "help:status")
        {
            kind = "help-status";
        }
        else if (data == "help:back")
        {
            kind = "help-back";
        }
        if (kind == null) return null;
        return new ChannelMenuAction
        {
            Kind = kind,
            ChannelId = channel.Id,
            // 群组按点击者身份（from.id）走绑定/会话/权限，ChatId 仅作发送目标。
            ExternalId = cq.From?.Id.ToString() ?? chatId,
            ChatId = chatId,
            CallbackQueryId = cq.Id,
            MessageId = msg.Id,
            Data = payload,
        };
    }

    /// <summary>
    /// 把 Telegram 文本消息规范化为入站消息（纯函数，可测试）。
    /// 身份模型：私聊 ExternalId = chat id；群组 ExternalId = 发送者 from id
    /// （绑定/会话/权限按用户走），ReplyTo = 群 chat id（回复目标）。
    /// 群组过滤：AllowInGroups=false 时全部丢弃；开启时仅处理 @提及 bot 的
    /// 消息与 /bind 命令（未绑定用户的绑定引导），其余群组消息忽略。
    /// </summary>
    public static ChannelInboundMessage? TryParseMessage(AiChannel channel, Message msg, string? botUsername = null)
    {
        if (string.IsNullOrWhiteSpace(msg.Text) || msg.Chat?.Id == null) return null;
        // 忽略机器人自己的消息（防御性）。
        if (msg.From?.IsBot == true) return null;
        var chatId = msg.Chat.Id.ToString()!;

        // 群组权限：仅 @提及 bot 或 /bind 命令被处理。
        var isGroup = msg.Chat.Type is ChatType.Group or ChatType.Supergroup;
        if (isGroup)
        {
            if (!channel.AllowInGroups) return null;
            var text = msg.Text.TrimStart();
            var isBind = text.StartsWith("/bind", StringComparison.OrdinalIgnoreCase);
            if (!isBind && !MentionsBot(msg, botUsername)) return null;
        }

        var name = string.Join(' ', new[] { msg.From?.FirstName, msg.From?.LastName }.Where(s => !string.IsNullOrEmpty(s)));
        if (string.IsNullOrEmpty(name)) name = msg.From?.Username ?? chatId;
        return new ChannelInboundMessage
        {
            ChannelId = channel.Id,
            // 群组：身份 = 发送者用户 ID；回复目标 = 群 ID。
            ExternalId = isGroup ? (msg.From?.Id.ToString() ?? chatId) : chatId,
            ReplyTo = isGroup ? chatId : null,
            ExternalName = name,
            Text = msg.Text,
            // 幂等去重键：message_id 在单个 chat 内唯一，配合入站去重防御重放。
            DedupeKey = msg.Id.ToString(),
            OriginMessageId = msg.Id,
            IsGroup = isGroup,
        };
    }

    /// <summary>消息是否 @提及了本 bot（entities 优先，文本包含兜底）。</summary>
    private static bool MentionsBot(Message msg, string? botUsername)
    {
        if (string.IsNullOrEmpty(botUsername)) return false;
        var mention = "@" + botUsername;
        if (msg.Entities is { Length: > 0 } && msg.Text != null)
        {
            foreach (var e in msg.Entities)
            {
                if (e.Type == MessageEntityType.Mention
                    && e.Offset >= 0 && e.Offset + e.Length <= msg.Text.Length
                    && string.Equals(msg.Text.Substring(e.Offset, e.Length), mention, StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }
        return msg.Text?.Contains(mention, StringComparison.OrdinalIgnoreCase) == true;
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
///   - 登录：GET /ilink/bot/get_bot_qrcode?bot_type=3 → GET /get_qrcode_status 轮询（wait/scaned/confirmed/expired）；
///   - 入站：POST /ilink/bot/getupdates 长轮询（~35s 挂起），get_updates_buf 为不透明游标；
///   - 出站：POST /ilink/bot/sendmessage，必须回传入站消息的 context_token（按用户缓存）；
///   - 输入指示：POST /getconfig 取 typing_ticket（按用户缓存）→ POST /sendtyping status=1/2；
///   - 鉴权：AuthorizationType: ilink_bot_token + Bearer bot_token + X-WECHAT-UIN + iLink-App-Id/ClientVersion；
///   - 会话过期：ret/errcode -14 → 需重新扫码登录（换 bot_token）。
/// 基座地址固定为官方地址（设置页无需填写）；微信不支持流式输出（iLink 无消息编辑能力）。
/// </summary>
public class WeChatClawAdapter : IAiChannelAdapter
{
    /// <summary>微信 iLink 官方业务基座（固定，无需用户填写）。</summary>
    public const string DefaultBase = "https://ilinkai.weixin.qq.com";
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

    /// <summary>按用户缓存的 typing_ticket（键 = channelId|externalId；有效期约 24h，失败时自动重取）。</summary>
    private readonly ConcurrentDictionary<string, string> _typingTickets = new();

    /// <summary>
    /// 微信输入指示：getconfig 获取 typing_ticket（首次/失效时）→ sendtyping。
    /// start=true 显示"对方正在输入中"，false 取消。无 context_token 也能调用（按用户缓存）。
    /// </summary>
    public async Task<bool> SendTypingAsync(AiChannel channel, string externalId, bool start, CancellationToken ct)
    {
        if (!_typingTickets.TryGetValue($"{channel.Id}|{externalId}", out var ticket) || ticket.Length == 0)
        {
            ticket = await FetchTypingTicketAsync(channel, externalId, ct);
            if (ticket.Length == 0) return false;
        }
        var body = new JsonObject
        {
            ["ilink_user_id"] = externalId,
            ["typing_ticket"] = ticket,
            ["status"] = start ? 1 : 2,
            ["base_info"] = JsonNode.Parse(BaseInfo()),
        };
        try
        {
            var resp = await Client().SendAsync(BuildRequest(channel, "/ilink/bot/sendtyping", body.ToJsonString()), ct);
            var respBody = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"iLink sendtyping HTTP {(int)resp.StatusCode}: {Clip(respBody)}");
            var ret = JsonNode.Parse(respBody)?["ret"]?.GetValue<int>() ?? 0;
            if (ret == -14)
            {
                _contextTokens.Clear();
                _typingTickets.TryRemove($"{channel.Id}|{externalId}", out _);
                throw new SessionExpiredException("iLink 会话已过期，需要重新扫码登录");
            }
            if (ret != 0)
            {
                // ticket 可能失效：清掉缓存，下次重取。
                _typingTickets.TryRemove($"{channel.Id}|{externalId}", out _);
                return false;
            }
            return true;
        }
        catch (SessionExpiredException) { throw; }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "iLink sendtyping failed ({Channel} → {External})", channel.Id, externalId);
            return false;
        }
    }

    private async Task<string> FetchTypingTicketAsync(AiChannel channel, string externalId, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["ilink_user_id"] = externalId,
            ["base_info"] = JsonNode.Parse(BaseInfo()),
        };
        // getconfig 官方实现会带 context_token（若有）。
        var ctx = _contextTokens.GetValueOrDefault($"{channel.Id}|{externalId}");
        if (!string.IsNullOrEmpty(ctx)) body["context_token"] = ctx;
        try
        {
            var resp = await Client().SendAsync(BuildRequest(channel, "/ilink/bot/getconfig", body.ToJsonString()), ct);
            var respBody = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"iLink getconfig HTTP {(int)resp.StatusCode}: {Clip(respBody)}");
            var doc = JsonNode.Parse(respBody) as JsonObject ?? new JsonObject();
            var ret = doc["ret"]?.GetValue<int>() ?? 0;
            if (ret == -14)
            {
                _contextTokens.Clear();
                _typingTickets.Clear();
                throw new SessionExpiredException("iLink 会话已过期，需要重新扫码登录");
            }
            if (ret != 0) return "";
            var ticket = doc["typing_ticket"]?.GetValue<string>() ?? "";
            if (ticket.Length > 0) _typingTickets[$"{channel.Id}|{externalId}"] = ticket;
            return ticket;
        }
        catch (SessionExpiredException) { throw; }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "iLink getconfig failed ({Channel} → {External})", channel.Id, externalId);
            return "";
        }
    }

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
            _contextTokens.Clear(); // 会话过期：所有用户缓存 token 一并失效
            throw new SessionExpiredException("iLink 会话已过期，需要重新扫码登录");
        }
        if (ret != 0)
            throw new InvalidOperationException($"iLink sendmessage ret={ret}: {Clip(respBody)}");
    }

    public async Task<(bool Ok, string Message)> TestAsync(AiChannel channel, CancellationToken ct)
    {
        if (BotToken(channel) == null)
            return (false, "缺少 bot_token（需先在设置页完成扫码授权）");
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
        {
            _contextTokens.Clear(); // 会话过期：所有用户缓存 token 一并失效
            throw new SessionExpiredException("iLink 会话已过期，需要重新扫码登录");
        }
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

    /// <summary>获取 iLink 登录二维码（GET /ilink/bot/get_bot_qrcode?bot_type=3）。登录接口匿名，无需 bot_token。</summary>
    public async Task<(string Qrcode, string ImageUrl)> CreateQrCodeAsync(CancellationToken ct)
        => await CreateQrCodeAsync(DefaultBase, ct);

    /// <summary>获取 iLink 登录二维码（按频道基座地址；登录接口匿名，无需 bot_token）。</summary>
    public async Task<(string Qrcode, string ImageUrl)> CreateQrCodeAsync(AiChannel channel, CancellationToken ct)
        => await CreateQrCodeAsync(BaseUrl(channel), ct);

    private async Task<(string Qrcode, string ImageUrl)> CreateQrCodeAsync(string baseUrl, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(15));
        var req = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3");
        // 官方 SDK：登录阶段仅带 SKRouteTag（可选）；不要求 X-WECHAT-UIN / Authorization。
        req.Headers.Add("SKRouteTag", "1001");
        var resp = await Client().SendAsync(req, cts.Token);
        var respBody = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"iLink get_bot_qrcode HTTP {(int)resp.StatusCode}: {Clip(respBody)}");
        var doc = JsonNode.Parse(respBody) as JsonObject ?? new JsonObject();
        var qrcode = doc["qrcode"]?.GetValue<string>() ?? "";
        var imageUrl = doc["qrcode_img_content"]?.GetValue<string>() ?? "";
        if (qrcode.Length == 0)
            throw new InvalidOperationException($"iLink get_bot_qrcode 响应缺少 qrcode: {Clip(respBody)}");
        return (qrcode, imageUrl);
    }

    /// <summary>
    /// 轮询 iLink 扫码状态（GET /ilink/bot/get_qrcode_status?qrcode=…）。登录接口匿名，无需 bot_token。
    /// 返回 (status, botToken?, ilinkBotId?, baseUrl?)；status ∈ wait | scaned | confirmed | expired。
    /// </summary>
    public async Task<WeChatQrStatusResult> GetQrCodeStatusAsync(string qrcode, CancellationToken ct)
        => await GetQrCodeStatusAsync(DefaultBase, qrcode, ct);

    /// <summary>轮询 iLink 扫码状态（按频道基座地址）。</summary>
    public async Task<WeChatQrStatusResult> GetQrCodeStatusAsync(AiChannel channel, string qrcode, CancellationToken ct)
        => await GetQrCodeStatusAsync(BaseUrl(channel), qrcode, ct);

    private async Task<WeChatQrStatusResult> GetQrCodeStatusAsync(string baseUrl, string qrcode, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(40)); // 官方实现长轮询 ~35s
        var req = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/ilink/bot/get_qrcode_status?qrcode={Uri.EscapeDataString(qrcode)}");
        req.Headers.Add("iLink-App-ClientVersion", "1");
        req.Headers.Add("SKRouteTag", "1001");
        var resp = await Client().SendAsync(req, cts.Token);
        var respBody = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"iLink get_qrcode_status HTTP {(int)resp.StatusCode}: {Clip(respBody)}");
        var doc = JsonNode.Parse(respBody) as JsonObject ?? new JsonObject();
        var status = doc["status"]?.GetValue<string>() ?? "wait";
        return new WeChatQrStatusResult
        {
            Status = status,
            BotToken = doc["bot_token"]?.GetValue<string>() ?? "",
            ILinkBotId = doc["ilink_bot_id"]?.GetValue<string>() ?? "",
            BaseUrl = doc["baseurl"]?.GetValue<string>() ?? "",
        };
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
