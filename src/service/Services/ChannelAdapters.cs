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

public static class AiChannelTypes
{
    public const string Telegram = "telegram";
    public const string Lark = "lark";
    public const string WechatClaw = "wechat-claw";

    public static readonly HashSet<string> SensitiveKeys = new(StringComparer.Ordinal)
    {
        "botToken", "appSecret", "encryptKey", "ilinkKey", "webhookSecret",
    };

    public static readonly string[] PollingTypes = { WechatClaw };
}

public sealed class ChannelInboundMessage
{
    public required string ChannelId { get; init; }
    public required string ExternalId { get; init; }
    public string? ReplyTo { get; init; }
    public string ExternalName { get; init; } = "";
    public required string Text { get; init; }
    /// <summary>
    /// </summary>
    public string? DedupeKey { get; init; }
    public long? OriginMessageId { get; init; }
    public bool IsGroup { get; init; }
}

public sealed class ChannelPollBatch
{
    public string? NewCursor { get; init; }
    public List<ChannelInboundMessage> Messages { get; init; } = new();
}

public sealed class ChannelMedia
{
    public required string Type { get; init; }
    public required string Url { get; init; }
    public string? FileName { get; init; }
    public string? Caption { get; init; }
}

public sealed class CallbackAction
{
    public required string ChannelId { get; init; }
    public required string ExternalId { get; init; }
    public required string SessionId { get; init; }
    public required string ToolCallId { get; init; }
    public bool Approved { get; init; }
    public required string Permit { get; init; }
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

public sealed class ChannelMenuAction
{
    public required string Kind { get; init; }
    public required string ChannelId { get; init; }
    public required string ExternalId { get; init; }
    public required string ChatId { get; init; }
    public required string CallbackQueryId { get; init; }
    public int MessageId { get; init; }
    public string? Data { get; init; }
}

public interface IAiChannelAdapter
{
    string ChannelType { get; }

    Task SendTextAsync(AiChannel channel, string externalId, string text, CancellationToken ct);

    Task SendMediaAsync(AiChannel channel, string externalId, ChannelMedia media, CancellationToken ct) =>
        SendTextAsync(channel, externalId, string.IsNullOrEmpty(media.Caption) ? media.Url : $"{media.Caption}\n{media.Url}", ct);

    /// <summary>
    /// </summary>
    Task SendApprovalAsync(AiChannel channel, string externalId, string html, string plain, string sessionId, string toolCallId, CancellationToken ct) =>
        SendTextAsync(channel, externalId, plain, ct);

    /// <summary>
    /// </summary>
    Task DeleteApprovalMessageAsync(AiChannel channel, string sessionId, string toolCallId, CancellationToken ct) =>
        Task.CompletedTask;

    Task<(bool Ok, string Message)> TestAsync(AiChannel channel, CancellationToken ct);

    bool SupportsRichText => false;

    /// <summary>
    /// </summary>
    /// <summary>
    /// AI reply formatted as Markdown. Adapters that understand Markdown
    /// (e.g. Telegram) render it; the default is plain text.
    /// </summary>
    Task SendMarkdownAsync(AiChannel channel, string externalId, string markdown, CancellationToken ct) =>
        SendTextAsync(channel, externalId, markdown, ct);

    /// <summary>
    /// </summary>
    Task SendRichTextAsync(AiChannel channel, string externalId, string html, string plain, CancellationToken ct) =>
        SendTextAsync(channel, externalId, plain, ct);

    /// <summary>
    /// </summary>
    Task<bool> DeleteMessageAsync(AiChannel channel, string externalId, long messageId, CancellationToken ct) =>
        Task.FromResult(false);

    Task<string> GetBotUsernameAsync(AiChannel channel, CancellationToken ct) =>
        Task.FromResult("");

    /// <summary>
    /// </summary>
    Task SendKeyboardAsync(AiChannel channel, string externalId, string html, string plain, IReadOnlyList<string> buttons, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>
    /// </summary>
    Task<long> StartStreamAsync(AiChannel channel, string externalId, string text, CancellationToken ct) =>
        Task.FromResult(0L);

    Task UpdateStreamAsync(AiChannel channel, string externalId, long messageId, string text, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>
    /// </summary>
    Task<long> SendMenuAsync(AiChannel channel, string externalId, string html, string plain, IReadOnlyList<IReadOnlyList<(string Text, string Data)>> rows, CancellationToken ct) =>
        Task.FromResult(0L);

    Task<bool> EditMenuAsync(AiChannel channel, string chatId, long messageId, string html, string plain, IReadOnlyList<IReadOnlyList<(string Text, string Data)>>? rows, CancellationToken ct) =>
        Task.FromResult(false);

    Task<ChannelPollBatch> PollAsync(AiChannel channel, string? cursor, CancellationToken ct) =>
        Task.FromResult(new ChannelPollBatch { NewCursor = cursor });
}

public sealed class WeChatQrStatusResult
{
    public string Status { get; init; } = "wait";
    public string? BotToken { get; init; }
    public string? ILinkBotId { get; init; }
    public string? BaseUrl { get; init; }
}

public sealed class SessionExpiredException : Exception
{
    public SessionExpiredException(string message) : base(message) { }
}

/// <summary>
/// </summary>
public class TelegramChannelAdapter : IAiChannelAdapter
{
    private readonly ILogger<TelegramChannelAdapter> _logger;
    private readonly ConcurrentDictionary<string, ITelegramBotClient> _clients = new();
    private readonly ConcurrentDictionary<string, ApprovalButton> _approvalButtons = new();
    private readonly ConcurrentDictionary<string, (string ChatId, int MessageId)> _pendingApprovalMessages = new();

    public TelegramChannelAdapter(ILogger<TelegramChannelAdapter> logger)
    {
        _logger = logger;
    }

    public string ChannelType => AiChannelTypes.Telegram;

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

    /// <summary>
    /// AI replies are rendered as Markdown on Telegram. Legacy ParseMode.Markdown
    /// is strict: unescaped dots in numbered lists or unsupported tables cause a
    /// 400, which would silently fall back to plain text — sanitize first,
    /// then fall back to plain text only if it still fails.
    /// </summary>
    public async Task SendMarkdownAsync(AiChannel channel, string externalId, string markdown, CancellationToken ct)
    {
        var safe = SanitizeTelegramMarkdown(markdown);
        try
        {
            await Bot(channel).SendMessage(externalId, safe, parseMode: ParseMode.Markdown, cancellationToken: ct);
        }
        catch (Exception)
        {
            await Bot(channel).SendMessage(externalId, safe, cancellationToken: ct);
        }
    }

    /// <summary>
    /// Make AI markdown acceptable to Telegram's legacy Markdown parser:
    /// escape the dot in numbered lists, flatten tables to text lines,
    /// strip the table separator rows.
    /// </summary>
    private static string SanitizeTelegramMarkdown(string md)
    {
        var lines = md.Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var trimmed = lines[i].Trim();
            if (trimmed.StartsWith('|') && trimmed.EndsWith('|') && trimmed.Count(c => c == '|') >= 3)
            {
                // 表格分隔行 |---|---| 去掉;数据行 | a | b | 展平为 "• a | b"
                if (trimmed.Contains("---") && System.Text.RegularExpressions.Regex.IsMatch(trimmed, @"^\|[\s:\-|]+\|$"))
                {
                    lines[i] = "";
                    continue;
                }
                var cells = trimmed.Trim('|').Split('|').Select(c => c.Trim()).ToList();
                lines[i] = "• " + string.Join(" | ", cells);
            }
        }
        var text = string.Join("\n", lines);
        // 数字列表 "1. " -> "1\. "(legacy Markdown 要求转义圆点,否则 400)
        text = System.Text.RegularExpressions.Regex.Replace(text, @"(?m)^(\s*\d{1,3})\. ", "$1\\. ");
        return text;
    }

    public async Task SendRichTextAsync(AiChannel channel, string externalId, string html, string plain, CancellationToken ct)
    {
        try
        {
            await Bot(channel).SendMessage(externalId, html, parseMode: ParseMode.Html, cancellationToken: ct);
        }
        catch (Exception)
        {
            await Bot(channel).SendMessage(externalId, plain, cancellationToken: ct);
        }
    }

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
                await bot.SendDocument(externalId, file, caption: media.Caption, cancellationToken: ct);
                break;
        }
    }

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
        _pendingApprovalMessages[$"{sessionId}:{toolCallId}"] = (externalId, sent.Id);
    }

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

    public async Task<long> StartStreamAsync(AiChannel channel, string externalId, string text, CancellationToken ct)
    {
        var sent = await Bot(channel).SendMessage(externalId, text, cancellationToken: ct);
        return sent.Id;
    }

    public async Task UpdateStreamAsync(AiChannel channel, string externalId, long messageId, string text, CancellationToken ct)
    {
        await Bot(channel).EditMessageText(externalId, (int)messageId, text, cancellationToken: ct);
    }

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

    private static InlineKeyboardMarkup BuildMenuMarkup(IReadOnlyList<IReadOnlyList<(string Text, string Data)>> rows) =>
        new(rows.Select(row => row.Select(b => InlineKeyboardButton.WithCallbackData(b.Text, b.Data)).ToArray()));

    /// <summary>
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
    /// </summary>
    public async Task StartReceivingAsync(
        AiChannel channel,
        Func<ChannelInboundMessage, CancellationToken, Task> onInbound,
        Func<CallbackAction, CancellationToken, Task<CallbackResult>> onCallback,
        Func<ChannelMenuAction, CancellationToken, Task> onMenuCallback,
        CancellationToken ct)
    {
        var bot = Bot(channel);
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
                AllowedUpdates = null,
            },
            ct);
    }

    private static readonly BotCommand[] BotCommands =
    {
        new() { Command = "start", Description = "开始使用" },
        new() { Command = "help", Description = "显示帮助" },
        new() { Command = "status", Description = "查看绑定与档位" },
        new() { Command = "bind", Description = "绑定控制台账号" },
        new() { Command = "model", Description = "切换模型" },
        new() { Command = "tier", Description = "切换档位" },
    };

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
            if (action != null)
            {
                HandleApprovalCallbackAsync(channel, bot, action, onCallback, ct);
                return;
            }
            var menu = TryResolveMenu(channel, cq);
            if (menu != null)
            {
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
            ExternalId = cq.From?.Id.ToString() ?? chatId,
            ChatId = chatId,
            CallbackQueryId = cq.Id,
            MessageId = msg.Id,
            Data = payload,
        };
    }

    /// <summary>
    /// </summary>
    public static ChannelInboundMessage? TryParseMessage(AiChannel channel, Message msg, string? botUsername = null)
    {
        if (string.IsNullOrWhiteSpace(msg.Text) || msg.Chat?.Id == null) return null;
        if (msg.From?.IsBot == true) return null;
        var chatId = msg.Chat.Id.ToString()!;

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
            ExternalId = isGroup ? (msg.From?.Id.ToString() ?? chatId) : chatId,
            ReplyTo = isGroup ? chatId : null,
            ExternalName = name,
            Text = msg.Text,
            DedupeKey = msg.Id.ToString(),
            OriginMessageId = msg.Id,
            IsGroup = isGroup,
        };
    }

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

public sealed class ApprovalButton
{
    public required string ChannelId { get; init; }
    public required string ExternalId { get; init; }
    public required string SessionId { get; init; }
    public required string ToolCallId { get; init; }
    public DateTime ExpiresAt { get; init; }
}

/// <summary>
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
    /// </summary>
    public async Task<ChannelInboundMessage?> ParseWebhookAsync(
        AiChannel channel, string rawBody, string? larkTimestamp, string? larkNonce, string? larkSignature, CancellationToken ct)
    {
        var encryptKey = Get(channel, "encryptKey");
        var bodyText = rawBody;

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
    /// </summary>
    public ChannelInboundMessage? ParseEventEnvelope(AiChannel channel, JsonObject root)
    {
        var eventType = root["header"]?["event_type"]?.GetValue<string>() ?? "";
        if (eventType != "im.message.receive_v1") return null;
        var evt = root["event"] as JsonObject;
        if (evt == null) return null;

        var senderType = evt["sender"]?["sender_type"]?.GetValue<string>() ?? "";
        if (senderType != "user") return null;
        var openId = evt["sender"]?["sender_id"]?["open_id"]?.GetValue<string>() ?? "";
        if (openId.Length == 0) return null;
        var msgType = evt["message"]?["message_type"]?.GetValue<string>() ?? "";
        if (msgType != "text") return null;
        var content = evt["message"]?["content"]?.GetValue<string>() ?? "{}";
        var text = JsonNode.Parse(content)?["text"]?.GetValue<string>() ?? "";
        if (text.Length == 0) return null;
        var chatId = evt["message"]?["chat_id"]?.GetValue<string>() ?? "";
        var chatType = evt["message"]?["chat_type"]?.GetValue<string>() ?? "p2p";
        var name = evt["sender"]?["sender_id"]?["union_id"]?.GetValue<string>() ?? openId;

        return new ChannelInboundMessage
        {
            ChannelId = channel.Id,
            ExternalId = chatType == "p2p" ? openId : chatId,
            ExternalName = name,
            Text = text,
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
/// </summary>
public class WeChatClawAdapter : IAiChannelAdapter
{
    public const string DefaultBase = "https://ilinkai.weixin.qq.com";
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<WeChatClawAdapter> _logger;
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
        c.Timeout = TimeSpan.FromSeconds(50);
        return c;
    }

    private static string RandomWechatUin()
    {
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
        req.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        return req;
    }

    private static string BaseInfo() =>
        "{\"channel_version\":\"2.0.0\",\"bot_agent\":\"Libra-Nextgen/1.0\"}";

    private static string Clip(string s) => s.Length > 300 ? s[..300] : s;

    private readonly ConcurrentDictionary<string, string> _typingTickets = new();

    /// <summary>
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
            ["context_token"] = _contextTokens.GetValueOrDefault($"{channel.Id}|{externalId}") ?? "",
            ["base_info"] = JsonNode.Parse(BaseInfo()),
        };
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

        var msg = new JsonObject
        {
            ["from_user_id"] = "",
            ["to_user_id"] = externalId,
            ["client_id"] = $"libra-weixin:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{RandomNumberGenerator.GetHexString(8)}",
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
            _contextTokens.Clear();
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
            _contextTokens.Clear();
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
                if ((m["message_type"]?.GetValue<int>() ?? 0) != 1) continue;
                if ((m["message_state"]?.GetValue<int>() ?? 0) != 2) continue;
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

    public async Task<(string Qrcode, string ImageUrl)> CreateQrCodeAsync(CancellationToken ct)
        => await CreateQrCodeAsync(DefaultBase, ct);

    public async Task<(string Qrcode, string ImageUrl)> CreateQrCodeAsync(AiChannel channel, CancellationToken ct)
        => await CreateQrCodeAsync(BaseUrl(channel), ct);

    private async Task<(string Qrcode, string ImageUrl)> CreateQrCodeAsync(string baseUrl, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(15));
        var req = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3");
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
    /// </summary>
    public async Task<WeChatQrStatusResult> GetQrCodeStatusAsync(string qrcode, CancellationToken ct)
        => await GetQrCodeStatusAsync(DefaultBase, qrcode, ct);

    public async Task<WeChatQrStatusResult> GetQrCodeStatusAsync(AiChannel channel, string qrcode, CancellationToken ct)
        => await GetQrCodeStatusAsync(BaseUrl(channel), qrcode, ct);

    private async Task<WeChatQrStatusResult> GetQrCodeStatusAsync(string baseUrl, string qrcode, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(35));
        var req = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/ilink/bot/get_qrcode_status?qrcode={Uri.EscapeDataString(qrcode)}");
        req.Headers.Add("iLink-App-ClientVersion", "1");
        try
        {
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
        catch (OperationCanceledException)
        {
            return new WeChatQrStatusResult { Status = "wait" };
        }
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
