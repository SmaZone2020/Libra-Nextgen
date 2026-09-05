using System.Collections.Concurrent;
using System.Linq.Expressions;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services.Ai;

/// <summary>
/// </summary>
public class AiChannelService
{
    private const int RateLimitWindowSec = 60;
    private const int RateLimitMax = 10;
    private const int MaxMessageLength = 2000;
    private const int ChunkSize = 3500;
    private const string SecretSentinel = "********";
    private const string GuestPrefix = "ch:guest:";

    private static readonly string[] ThinkingPhrases =
    {
        "Thinking…",
        "Looking for bugs…",
        "Blushing…",
        "Hmm, let me think…",
        "Analyzing…",
        "Consulting the oracle…",
    };
    private static int _thinkingIdx;
    private static string NextThinkingPhrase() =>
        ThinkingPhrases[(Interlocked.Increment(ref _thinkingIdx) & 0x7fffffff) % ThinkingPhrases.Length];

    private readonly IStore<AiChannel> _channels;
    private readonly IStore<AiChannelUser> _channelUsers;
    private readonly IStore<AiChannelBindCode> _bindCodes;
    private readonly IStore<AiChannelCursor> _cursors;
    private readonly AiService _ai;
    private readonly AuditService _audit;
    private readonly ConnectionManager _ws;
    private readonly Repository<User> _users;
    private readonly TelegramChannelAdapter _telegram;
    private readonly LarkChannelAdapter _lark;
    private readonly WeChatClawAdapter _claw;
    private readonly ILogger<AiChannelService> _logger;

    private readonly ConcurrentDictionary<string, Queue<DateTime>> _rateBuckets = new();
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _gates = new();
    private readonly ConcurrentDictionary<string, Action> _typingKeepalives = new();

    public AiChannelService(
        IStore<AiChannel> channels,
        IStore<AiChannelUser> channelUsers,
        IStore<AiChannelBindCode> bindCodes,
        IStore<AiChannelCursor> cursors,
        AiService ai,
        AuditService audit,
        ConnectionManager ws,
        Repository<User> users,
        TelegramChannelAdapter telegram,
        LarkChannelAdapter lark,
        WeChatClawAdapter claw,
        ILogger<AiChannelService> logger)
    {
        _channels = channels;
        _channelUsers = channelUsers;
        _bindCodes = bindCodes;
        _cursors = cursors;
        _ai = ai;
        _audit = audit;
        _ws = ws;
        _users = users;
        _telegram = telegram;
        _lark = lark;
        _claw = claw;
        _logger = logger;
    }

    private readonly ConcurrentDictionary<string, DateTime> _seenInbound = new();
    private const int SeenInboundMax = 2000;
    private static readonly TimeSpan SeenInboundTtl = TimeSpan.FromMinutes(30);

    private readonly ConcurrentDictionary<string, ModelMenuState> _modelMenus = new();
    private const int ModelMenuPageSize = 5;

    private sealed class ModelMenuState
    {
        public List<(string Id, string Name)> Providers { get; set; } = new();
        public int ProviderIndex { get; set; } = -1;
        public List<string> Models { get; set; } = new();
        public string CurrentModel { get; set; } = "";
        public int Page { get; set; }
        public string? Query { get; set; }
        public bool Searching { get; set; }
        public long MessageId { get; set; }
        public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddMinutes(10);
    }

    private IAiChannelAdapter AdapterFor(string type) => type switch
    {
        AiChannelTypes.Telegram => _telegram,
        AiChannelTypes.Lark => _lark,
        AiChannelTypes.WechatClaw => _claw,
        _ => throw new ArgumentException($"unsupported channel type '{type}'"),
    };


    public static void MaskConfig(AiChannel ch)
    {
        foreach (var key in AiChannelTypes.SensitiveKeys)
            if (ch.Config.TryGetValue(key, out var v) && v.Length > 0)
                ch.Config[key] = SecretSentinel;
    }

    private static void EncryptSensitive(AiChannel ch)
    {
        foreach (var key in AiChannelTypes.SensitiveKeys)
            if (ch.Config.TryGetValue(key, out var v) && v.Length > 0 && v != SecretSentinel)
                ch.Config[key] = AiService.EncryptKey(v);
    }

    private static void DecryptSensitive(AiChannel ch)
    {
        foreach (var key in AiChannelTypes.SensitiveKeys)
            if (ch.Config.TryGetValue(key, out var v) && v.Length > 0 && v != SecretSentinel)
                ch.Config[key] = AiService.DecryptKey(v);
    }

    private static void Validate(AiChannel ch)
    {
        if (string.IsNullOrWhiteSpace(ch.Name)) throw new ArgumentException("name is required");
        if (ch.ChannelType is not (AiChannelTypes.Telegram or AiChannelTypes.Lark or AiChannelTypes.WechatClaw))
            throw new ArgumentException($"unsupported channel type '{ch.ChannelType}'");
        var required = ch.ChannelType switch
        {
            AiChannelTypes.Telegram => new[] { "botToken" },
            AiChannelTypes.Lark => new[] { "appId", "appSecret" },
            AiChannelTypes.WechatClaw => Array.Empty<string>(),
            _ => throw new ArgumentException($"unsupported channel type '{ch.ChannelType}'"),
        };
        foreach (var k in required)
            if (!ch.Config.TryGetValue(k, out var v) || string.IsNullOrWhiteSpace(v) || v == SecretSentinel)
                throw new ArgumentException($"缺少配置项 {k}");
        if (ch.DefaultTier is < 0 or > 3) ch.DefaultTier = 0;
    }


    public async Task<List<AiChannel>> ListChannelsAsync(bool includeSecrets, CancellationToken ct = default)
    {
        var list = await _channels.FindPagedAsync(
            null, 1, int.MaxValue, nameof(AiChannel.CreatedAt), true, ct);
        foreach (var ch in list)
        {
            if (includeSecrets) DecryptSensitive(ch); else MaskConfig(ch);
        }
        return list;
    }

    public async Task<AiChannel?> GetChannelAsync(string id, bool includeSecrets, CancellationToken ct = default)
    {
        var ch = await _channels.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (ch == null) return null;
        if (includeSecrets) DecryptSensitive(ch); else MaskConfig(ch);
        return ch;
    }

    public async Task<List<AiChannel>> GetEnabledChannelsAsync(IEnumerable<string>? types = null, CancellationToken ct = default)
    {
        Expression<Func<AiChannel, bool>> filter = c => c.Enabled == true;
        if (types != null)
        {
            var list = types.ToList();
            if (list.Count > 0)
            {
                Expression<Func<AiChannel, bool>>? typeFilter = null;
                foreach (var type in list)
                    typeFilter = typeFilter is null
                        ? (Expression<Func<AiChannel, bool>>)(c => c.ChannelType == type)
                        : ExpressionCombine.OrElse<AiChannel>(typeFilter, c => c.ChannelType == type);
                filter = ExpressionCombine.AndAlso(filter, typeFilter);
            }
        }
        var result = await _channels.FindAsync(filter, ct);
        foreach (var ch in result)
        {
            try { DecryptSensitive(ch); }
            catch (Exception ex) { _logger.LogWarning(ex, "Failed to decrypt channel config ({Channel}) — sensitive fields skipped", ch.Id); }
        }
        return result;
    }

    public async Task<AiChannel> CreateChannelAsync(AiChannel input, CancellationToken ct = default)
    {
        var ch = new AiChannel
        {
            Name = input.Name.Trim(),
            ChannelType = input.ChannelType,
            Enabled = input.Enabled,
            Config = new Dictionary<string, string>(input.Config, StringComparer.Ordinal),
            DefaultTier = input.DefaultTier,
            RequireBind = input.RequireBind,
            DefaultProviderId = input.DefaultProviderId ?? "",
            DefaultModel = input.DefaultModel ?? "",
            ShowToolCalls = input.ShowToolCalls,
            StreamOutput = input.StreamOutput,
            AllowInGroups = input.AllowInGroups,
        };
        if (ch.ChannelType == AiChannelTypes.WechatClaw)
        {
            ch.Config["baseUrl"] = WeChatClawAdapter.DefaultBase;
            ch.StreamOutput = false;
        }
        Validate(ch);
        EncryptSensitive(ch);
        await _channels.InsertAsync(ch, ct);
        MaskConfig(ch);
        return ch;
    }

    public async Task<bool> UpdateChannelAsync(string id, AiChannel input, CancellationToken ct = default)
    {
        var existing = await GetChannelAsync(id, includeSecrets: true, ct);
        if (existing == null) return false;

        foreach (var key in AiChannelTypes.SensitiveKeys)
            if (input.Config.TryGetValue(key, out var v) && (v == SecretSentinel || v.Length == 0))
                input.Config[key] = existing.Config.GetValueOrDefault(key, "");

        var ch = new AiChannel
        {
            Id = id,
            Name = input.Name.Trim(),
            ChannelType = input.ChannelType,
            Enabled = input.Enabled,
            Config = new Dictionary<string, string>(input.Config, StringComparer.Ordinal),
            DefaultTier = input.DefaultTier,
            RequireBind = input.RequireBind,
            DefaultProviderId = input.DefaultProviderId ?? "",
            DefaultModel = input.DefaultModel ?? "",
            ShowToolCalls = input.ShowToolCalls,
            StreamOutput = input.StreamOutput,
            AllowInGroups = input.AllowInGroups,
            CreatedAt = existing.CreatedAt,
            UpdatedAt = DateTime.UtcNow,
        };
        if (ch.ChannelType == AiChannelTypes.WechatClaw && !ch.Config.ContainsKey("baseUrl"))
            ch.Config["baseUrl"] = WeChatClawAdapter.DefaultBase;
        if (ch.ChannelType == AiChannelTypes.WechatClaw) ch.StreamOutput = false;
        Validate(ch);
        EncryptSensitive(ch);
        var modified = await _channels.UpdateOneAsync(x => x.Id == id, new[]
        {
            new FieldUpdate(nameof(AiChannel.Name), ch.Name),
            new FieldUpdate(nameof(AiChannel.ChannelType), ch.ChannelType),
            new FieldUpdate(nameof(AiChannel.Enabled), ch.Enabled),
            new FieldUpdate(nameof(AiChannel.Config), ch.Config),
            new FieldUpdate(nameof(AiChannel.DefaultTier), ch.DefaultTier),
            new FieldUpdate(nameof(AiChannel.RequireBind), ch.RequireBind),
            new FieldUpdate(nameof(AiChannel.DefaultProviderId), ch.DefaultProviderId),
            new FieldUpdate(nameof(AiChannel.DefaultModel), ch.DefaultModel),
            new FieldUpdate(nameof(AiChannel.ShowToolCalls), ch.ShowToolCalls),
            new FieldUpdate(nameof(AiChannel.StreamOutput), ch.StreamOutput),
            new FieldUpdate(nameof(AiChannel.AllowInGroups), ch.AllowInGroups),
            new FieldUpdate(nameof(AiChannel.UpdatedAt), ch.UpdatedAt),
        }, ct);
        if (modified > 0) return true;
        return await _channels.ExistsAsync(x => x.Id == id, ct);
    }

    public async Task<bool> DeleteChannelAsync(string id, CancellationToken ct = default)
    {
        var deleted = await _channels.DeleteAsync(id, ct);
        if (deleted == 0) return false;
        foreach (var u in await _channelUsers.FindAsync(x => x.ChannelId == id, ct))
            await _channelUsers.DeleteAsync(u.Id, ct);
        foreach (var b in await _bindCodes.FindAsync(x => x.ChannelId == id, ct))
            await _bindCodes.DeleteAsync(b.Id, ct);
        await DeletePollCursorAsync(id, ct);
        await _ai.DeleteChannelSessionsAsync(id, ct);
        return true;
    }

    public async Task<(bool Ok, string? Error)> TestChannelAsync(AiChannel input, CancellationToken ct = default)
    {
        var probe = new AiChannel
        {
            Name = input.Name,
            ChannelType = input.ChannelType,
            Config = new Dictionary<string, string>(input.Config, StringComparer.Ordinal),
        };
        try
        {
            EncryptSensitive(probe);
            DecryptSensitive(probe);
            var (ok, msg) = await AdapterFor(probe.ChannelType).TestAsync(probe, ct);
            return (ok, ok ? null : msg);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public Task<List<AiSession>> MyChannelSessionsAsync(string userId, CancellationToken ct = default)
        => _ai.GetChannelSessionsAsync(userId, ct);

    public Task<ChannelPollBatch> PollChannelAsync(AiChannel channel, string? cursor, CancellationToken ct = default)
        => AdapterFor(channel.ChannelType).PollAsync(channel, cursor, ct);

    public async Task<string> GetPollCursorAsync(string channelId, CancellationToken ct = default)
    {
        var c = await _cursors.FirstOrDefaultAsync(x => x.ChannelId == channelId, ct);
        return c?.Cursor ?? "";
    }

    public async Task SetPollCursorAsync(string channelId, string cursor, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(cursor)) return;
        var existing = await _cursors.FirstOrDefaultAsync(x => x.ChannelId == channelId, ct);
        if (existing == null)
        {
            await _cursors.InsertAsync(new AiChannelCursor { ChannelId = channelId, Cursor = cursor }, ct);
        }
        else
        {
            await _cursors.UpdateByIdAsync(existing.Id, new[]
            {
                new FieldUpdate(nameof(AiChannelCursor.Cursor), cursor),
                new FieldUpdate(nameof(AiChannelCursor.UpdatedAt), DateTime.UtcNow),
            }, ct);
        }
    }

    public async Task DeletePollCursorAsync(string channelId, CancellationToken ct = default)
    {
        await _cursors.DeleteManyAsync(x => x.ChannelId == channelId, ct);
    }

    /// <summary>
    /// </summary>
    public async Task<bool> SetChannelTokenAsync(
        string id, string token, string? baseUrl = null, string? ilinkBotId = null, CancellationToken ct = default)
    {
        var ch = await GetChannelAsync(id, includeSecrets: true, ct);
        if (ch == null) return false;
        var value = token?.Trim() ?? "";
        if (value.Length == 0 || value == SecretSentinel)
        {
            ch.Config["botToken"] = "";
            await DeletePollCursorAsync(id, ct);
        }
        else
        {
            ch.Config["botToken"] = value;
            if (!string.IsNullOrWhiteSpace(baseUrl))
                ch.Config["baseUrl"] = baseUrl.Trim().TrimEnd('/');
            if (!string.IsNullOrWhiteSpace(ilinkBotId))
                ch.Config["ilinkBotId"] = ilinkBotId.Trim();
        }
        EncryptSensitive(ch);
        await _channels.ReplaceByIdAsync(id, ch, ct);
        return true;
    }


    private static readonly char[] CodeAlphabet =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray();

    public static string GenerateBindCode()
    {
        var bytes = RandomNumberGenerator.GetBytes(8);
        var sb = new StringBuilder(8);
        foreach (var b in bytes) sb.Append(CodeAlphabet[b % CodeAlphabet.Length]);
        return sb.ToString();
    }

    public static string HashCode(string code) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code.Trim().ToUpperInvariant())));

    /// <summary>
    /// </summary>
    public async Task<(string Code, DateTime ExpiresAt, string? BindUrl)> CreateBindCodeAsync(
        string channelId, string boundUserId, CancellationToken ct = default)
    {
        var ch = await _channels.FirstOrDefaultAsync(x => x.Id == channelId, ct)
            ?? throw new KeyNotFoundException("channel not found");
        var user = await _users.GetByIdAsync(boundUserId, ct)
            ?? throw new KeyNotFoundException("user not found");
        var code = GenerateBindCode();
        var expiresAt = DateTime.UtcNow.AddMinutes(15);
        await _bindCodes.InsertAsync(new AiChannelBindCode
        {
            ChannelId = channelId,
            BoundUserId = user.Id,
            BoundUserName = user.Username,
            CodeHash = HashCode(code),
            CodeTail = code.Length >= 4 ? code[^4..] : code,
            ExpiresAt = expiresAt,
        }, ct);
        _logger.LogInformation("Bind code created for channel {Channel} → user {User}", channelId, user.Username);
        string? bindUrl = null;
        if (ch.ChannelType == AiChannelTypes.Telegram)
        {
            var username = await AdapterFor(ch.ChannelType).GetBotUsernameAsync(ch, ct);
            if (!string.IsNullOrEmpty(username))
                bindUrl = $"https://t.me/{username}?start={code}";
        }
        return (code, expiresAt, bindUrl);
    }

    public async Task<List<AiChannelUser>> ListUsersAsync(string channelId, CancellationToken ct = default)
    {
        return await _channelUsers.FindPagedAsync(
            x => x.ChannelId == channelId, 1, int.MaxValue, nameof(AiChannelUser.BoundAt), true, ct);
    }

    public async Task<List<AiChannelBindCode>> ListBindCodesAsync(string channelId, CancellationToken ct = default)
    {
        return await _bindCodes.FindPagedAsync(
            x => x.ChannelId == channelId, 1, int.MaxValue, nameof(AiChannelBindCode.CreatedAt), true, ct);
    }

    public async Task<bool> RevokeBindCodeAsync(string channelId, string codeId, CancellationToken ct = default)
    {
        var modified = await _bindCodes.UpdateOneAsync(
            x => x.Id == codeId && x.ChannelId == channelId && x.UsedAt == null && x.RevokedAt == null,
            new[] { new FieldUpdate(nameof(AiChannelBindCode.RevokedAt), DateTime.UtcNow) },
            ct);
        if (modified == 0) return false;
        var bc = await _bindCodes.FirstOrDefaultAsync(x => x.Id == codeId, ct);
        if (bc != null)
        {
            await _audit.LogAsync(bc.BoundUserId, bc.BoundUserName, "AI channel bind code revoke", "ai.channel.bind.revoke",
                null, $"channel={channelId} tail={bc.CodeTail}", "console", RiskLevel.Safe);
        }
        return true;
    }

    public async Task<bool> SetUserTierAsync(string channelUserId, int? tier, CancellationToken ct = default)
    {
        if (tier is < 0 or > 3) throw new ArgumentException("tier must be 0-3 or null");
        var exists = await _channelUsers.ExistsAsync(x => x.Id == channelUserId, ct);
        if (!exists) return false;
        await _channelUsers.UpdateByIdAsync(channelUserId,
            new[] { new FieldUpdate(nameof(AiChannelUser.TierOverride), tier) }, ct);
        return true;
    }

    public async Task<bool> UnbindUserAsync(string channelUserId, CancellationToken ct = default)
    {
        var u = await _channelUsers.FirstOrDefaultAsync(x => x.Id == channelUserId, ct);
        if (u == null) return false;
        var deleted = await _channelUsers.DeleteAsync(u.Id, ct);
        if (deleted > 0)
        {
            await _audit.LogAsync(u.BoundUserId, u.BoundUserName, "AI channel unbind", "ai.channel.unbind",
                null, $"channel={u.ChannelId} external={u.ExternalId} ({u.ExternalName})", "console", RiskLevel.Safe);
        }
        return deleted > 0;
    }


    public async Task HandleInboundAsync(ChannelInboundMessage msg, CancellationToken ct = default)
    {
        if (!string.IsNullOrEmpty(msg.DedupeKey))
        {
            var seenKey = $"{msg.ChannelId}|{msg.DedupeKey}";
            if (!_seenInbound.TryAdd(seenKey, DateTime.UtcNow))
            {
                _logger.LogDebug("Dropped duplicate inbound {Key}", seenKey);
                return;
            }
            if (_seenInbound.Count > SeenInboundMax)
            {
                var cutoff = DateTime.UtcNow - SeenInboundTtl;
                foreach (var kv in _seenInbound.Where(kv => kv.Value < cutoff).ToList())
                    _seenInbound.TryRemove(kv.Key, out _);
            }
        }

        var ch = await GetChannelAsync(msg.ChannelId, includeSecrets: true, ct);
        if (ch == null || !ch.Enabled) return;

        var text = msg.Text.Trim();
        if (text.Length == 0) return;
        if (text.Length > MaxMessageLength) text = text[..MaxMessageLength] + "…";

        var menuKey = $"{ch.Id}|{msg.ExternalId}";
        if (_modelMenus.TryGetValue(menuKey, out var menuState) && menuState.Searching)
        {
            menuState.Searching = false;
            menuState.Query = text;
            menuState.Page = 0;
            if (msg.OriginMessageId is { } originId)
                await AdapterFor(ch.ChannelType).DeleteMessageAsync(ch, Target(msg), originId, ct);
            await RefreshModelMenuAsync(ch, Target(msg), menuState, ct);
            return;
        }

        if (IsRateLimited($"{ch.Id}|{msg.ExternalId}"))
        {
            await TrySendAsync(ch, Target(msg), "⏳ 操作过于频繁，请 1 分钟后再试。", ct);
            return;
        }

        if (msg.IsGroup)
        {
            var bound = await _channelUsers.FirstOrDefaultAsync(
                x => x.ChannelId == ch.Id && x.ExternalId == msg.ExternalId, ct);
            var isBindCmd = text.StartsWith("/bind", StringComparison.OrdinalIgnoreCase);
            if (bound == null && !isBindCmd)
            {
                _logger.LogDebug("Ignored group message from unbound user {External} (channel {Channel})", msg.ExternalId, ch.Id);
                return;
            }
        }

        if (text.StartsWith('/'))
        {
            await HandleCommandAsync(ch, msg, text, ct);
            return;
        }
        var alias = text.Trim().ToLowerInvariant();
        if (alias is "help" or "start")
        {
            await HandleCommandAsync(ch, msg, "/" + alias, ct);
            return;
        }

        var user = await _channelUsers.FirstOrDefaultAsync(
            x => x.ChannelId == ch.Id && x.ExternalId == msg.ExternalId, ct);
        if (user == null)
        {
            if (ch.RequireBind)
            {
                var (h, p) = BuildBindHelp(ch);
                await TrySendRichAsync(ch, Target(msg), h, p, ct);
                return;
            }
            await RunChatAsync(ch, msg, GuestUserId(ch.Id, msg.ExternalId), "guest", tier: 0, guest: true, ct);
            return;
        }

        _ = _channelUsers.UpdateByIdAsync(user.Id, new[]
        {
            new FieldUpdate(nameof(AiChannelUser.LastSeenAt), DateTime.UtcNow),
            new FieldUpdate(nameof(AiChannelUser.ExternalName), msg.ExternalName),
        }, ct);

        var tier = Math.Clamp(user.TierOverride ?? ch.DefaultTier, 0, 3);
        var auditName = $"{user.BoundUserName}({ch.ChannelType}:{msg.ExternalName})";
        await RunChatAsync(ch, msg, user.BoundUserId, auditName, tier, guest: false, ct);
    }

    private static string GuestUserId(string channelId, string externalId) => $"{GuestPrefix}{channelId}:{externalId}";
    private static bool IsGuestUserId(string userId) => userId.StartsWith(GuestPrefix, StringComparison.Ordinal);

    private static string Target(ChannelInboundMessage msg) => msg.ReplyTo ?? msg.ExternalId;

    private bool IsRateLimited(string key)
    {
        var now = DateTime.UtcNow;
        var q = _rateBuckets.GetOrAdd(key, _ => new Queue<DateTime>());
        lock (q)
        {
            while (q.Count > 0 && now - q.Peek() > TimeSpan.FromSeconds(RateLimitWindowSec)) q.Dequeue();
            if (q.Count >= RateLimitMax) return true;
            q.Enqueue(now);
            return false;
        }
    }

    private async Task HandleCommandAsync(AiChannel ch, ChannelInboundMessage msg, string text, CancellationToken ct)
    {
        var parts = text.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var cmd = parts.Length > 0 ? parts[0].ToLowerInvariant() : "";
        var atIdx = cmd.IndexOf('@');
        if (atIdx > 0) cmd = cmd[..atIdx];
        switch (cmd)
        {
            case "/start":
                {
                    if (parts.Length > 1)
                    {
                        await TryBindAsync(ch, msg, parts[1], ct);
                        break;
                    }
                    if (ch.ChannelType == AiChannelTypes.Telegram)
                    {
                        await AdapterFor(ch.ChannelType).SendKeyboardAsync(ch, Target(msg),
                            "我是 Justitia。\n输入 <code>/help</code> 查看可用指令。",
                            "我是 Justitia。\n输入 /help 查看可用指令。", new[] { "Help" }, ct);
                    }
                    else
                    {
                        await TrySendRichAsync(ch, Target(msg),
                            "我是 Justitia。\n输入 <code>/help</code> 查看可用指令。",
                            "我是 Justitia。\n输入 /help 查看可用指令。", ct);
                    }
                    break;
                }
            case "/help":
                {
                    var (h, p) = BuildHelp(ch);
                    if (ch.ChannelType == AiChannelTypes.Telegram)
                    {
                        var helpRows = new List<List<(string Text, string Data)>>
                    {
                        new()
                        {
                            ("🤖 模型", "help:model"),
                            ("🎚 档位", "help:tier"),
                            ("📊 状态", "help:status"),
                        },
                    };
                        await AdapterFor(ch.ChannelType).SendMenuAsync(ch, Target(msg), h, p, helpRows, ct);
                    }
                    else
                    {
                        await TrySendRichAsync(ch, Target(msg), h, p, ct);
                    }
                    break;
                }
            case "/status":
                {
                    var user = await _channelUsers.FirstOrDefaultAsync(
                        x => x.ChannelId == ch.Id && x.ExternalId == msg.ExternalId, ct);
                    var tier = user == null ? ch.DefaultTier : Math.Clamp(user.TierOverride ?? ch.DefaultTier, 0, 3);
                    var bound = user == null ? "未绑定" : user.BoundUserName;
                    await TrySendRichAsync(ch, Target(msg),
                        $"绑定：<b>{HtmlEncode(bound)}</b>\n档位：<b>{HtmlEncode(TierName(tier))}</b>",
                        $"绑定：{bound}\n档位：{TierName(tier)}", ct);
                    break;
                }
            case "/bind":
                if (parts.Length < 2)
                {
                    await TrySendRichAsync(ch, Target(msg),
                        "用法：<code>/bind 绑定码</code>", "用法：/bind 绑定码", ct);
                    return;
                }
                await TryBindAsync(ch, msg, parts[1], ct);
                break;
            case "/model":
                await HandleModelCommandAsync(ch, msg.ExternalId, msg.ReplyTo, ct);
                break;
            case "/tier":
                {
                    if (ch.ChannelType != AiChannelTypes.Telegram)
                    {
                        await TrySendAsync(ch, Target(msg), "该功能需要 Telegram 内联菜单支持。", ct);
                        break;
                    }
                    var tu = await _channelUsers.FirstOrDefaultAsync(
                        x => x.ChannelId == ch.Id && x.ExternalId == msg.ExternalId, ct);
                    if (tu == null)
                    {
                        await TrySendAsync(ch, Target(msg), "请先绑定控制台账号（/bind 绑定码）。", ct);
                        break;
                    }
                    var tcurrent = Math.Clamp(tu.TierOverride ?? ch.DefaultTier, 0, 3);
                    var (th, tp, tb) = BuildTierMenu(ch, tcurrent);
                    await AdapterFor(ch.ChannelType).SendMenuAsync(ch, Target(msg), th, tp, tb, ct);
                    break;
                }
            case "/approve":
            case "/reject":
                {
                    var permit = "one-time";
                    if (cmd == "/approve" && parts.Length > 1)
                    {
                        var p = parts[1].ToLowerInvariant();
                        if (p is "5min" or "20min") permit = p;
                    }
                    await TryResolveApprovalAsync(ch, msg, approved: cmd == "/approve", permit, ct);
                    break;
                }
            default:
                {
                    var (h, p) = BuildHelp(ch);
                    await TrySendRichAsync(ch, Target(msg), h, p, ct);
                    break;
                }
        }
    }


    private async Task HandleModelCommandAsync(AiChannel ch, string externalId, string? replyTo, CancellationToken ct)
    {
        if (ch.ChannelType != AiChannelTypes.Telegram)
        {
            await TrySendAsync(ch, replyTo ?? externalId, "该功能需要 Telegram 内联菜单支持。", ct);
            return;
        }
        var state = await CreateModelMenuStateAsync(ch, ct);
        if (state == null)
        {
            await TrySendAsync(ch, replyTo ?? externalId, "⚠️ 未配置可用的 AI 供应商。", ct);
            return;
        }
        var key = $"{ch.Id}|{externalId}";
        _modelMenus[key] = state;
        var (html, plain, buttons) = BuildProviderMenu(state);
        var menuId = await AdapterFor(ch.ChannelType).SendMenuAsync(ch, replyTo ?? externalId, html, plain, buttons, ct);
        if (menuId != 0)
        {
            state.MessageId = menuId;
        }
        else
        {
            _modelMenus.TryRemove(key, out _);
            await TrySendAsync(ch, replyTo ?? externalId, "当前频道不支持菜单按钮，请在控制台切换模型。", ct);
        }
    }

    private async Task<ModelMenuState?> CreateModelMenuStateAsync(AiChannel ch, CancellationToken ct)
    {
        var providers = await _ai.GetProvidersAsync(ct);
        var enabled = providers.Where(p => p.Enabled && p.Models.Count > 0).ToList();
        if (enabled.Count == 0) return null;
        var defaultIdx = Math.Max(0, enabled.FindIndex(p => p.Id == ch.DefaultProviderId));
        var defaultProvider = enabled[defaultIdx];
        var defaultModel = ch.DefaultModel.Length > 0 && defaultProvider.Models.Contains(ch.DefaultModel)
            ? ch.DefaultModel
            : (defaultProvider.DefaultModel.Length > 0 ? defaultProvider.DefaultModel : defaultProvider.Models[0]);
        return new ModelMenuState
        {
            Providers = enabled.Select(p => (p.Id, p.Name)).ToList(),
            ProviderIndex = defaultIdx,
            Models = defaultProvider.Models,
            CurrentModel = defaultModel,
        };
    }

    private static (string Html, string Plain, List<List<(string Text, string Data)>> Buttons) BuildProviderMenu(ModelMenuState state)
    {
        var html = new StringBuilder("<b>选择供应商</b>\n当前模型：<code>" + HtmlEncode(state.CurrentModel) + "</code>\n");
        var plain = new StringBuilder($"选择供应商\n当前模型：{state.CurrentModel}\n");
        var rows = new List<List<(string Text, string Data)>>();
        for (var i = 0; i < state.Providers.Count; i += 2)
        {
            var row = new List<(string Text, string Data)>();
            for (var j = 0; j < 2 && i + j < state.Providers.Count; j++)
            {
                var idx = i + j;
                var mark = idx == state.ProviderIndex ? "● " : "";
                html.Append($"\n<code>{HtmlEncode(mark + state.Providers[idx].Name)}</code>");
                plain.Append($"\n{mark}{state.Providers[idx].Name}");
                row.Add((mark + state.Providers[idx].Name, $"mdl:prov:{idx}"));
            }
            rows.Add(row);
        }
        rows.Add(new List<(string Text, string Data)> { ("🔙 返回", "help:back") });
        return (html.ToString(), plain.ToString(), rows);
    }

    private static (string Html, string Plain, List<List<(string Text, string Data)>> Buttons) BuildModelMenu(ModelMenuState state)
    {
        var filtered = string.IsNullOrEmpty(state.Query)
            ? state.Models
            : state.Models.Where(m => m.Contains(state.Query, StringComparison.OrdinalIgnoreCase)).ToList();
        var pages = Math.Max(1, (int)Math.Ceiling(filtered.Count / (double)ModelMenuPageSize));
        state.Page = Math.Clamp(state.Page, 0, pages - 1);
        var pageModels = filtered.Skip(state.Page * ModelMenuPageSize).Take(ModelMenuPageSize).ToList();

        var providerName = state.ProviderIndex >= 0 && state.ProviderIndex < state.Providers.Count
            ? state.Providers[state.ProviderIndex].Name
            : "";
        var title = string.IsNullOrEmpty(state.Query)
            ? $"选择模型（{providerName} {state.Page + 1}/{pages}）"
            : $"搜索「{state.Query}」（{providerName} {state.Page + 1}/{pages}）";
        var html = new StringBuilder($"<b>{HtmlEncode(title)}</b>\n当前：<code>{HtmlEncode(state.CurrentModel)}</code>\n");
        var plain = new StringBuilder($"{title}\n当前：{state.CurrentModel}\n");

        var rows = new List<List<(string Text, string Data)>>();
        foreach (var m in pageModels)
        {
            var idx = filtered.IndexOf(m);
            var mark = m == state.CurrentModel ? "● " : "";
            html.Append($"\n<code>{HtmlEncode(mark + m)}</code>");
            plain.Append($"\n{mark}{m}");
            rows.Add(new List<(string Text, string Data)> { (mark + m, $"mdl:sel:{idx}") });
        }

        var nav = new List<(string Text, string Data)>();
        if (state.Page > 0) nav.Add(("◀️", $"mdl:nav:{state.Page - 1}"));
        nav.Add(("🔍 搜索", "mdl:sea"));
        if (state.Page < pages - 1) nav.Add(("▶️", $"mdl:nav:{state.Page + 1}"));
        rows.Add(nav);
        rows.Add(new List<(string Text, string Data)> { ("🔙 返回", "mdl:provs") });

        return (html.ToString(), plain.ToString(), rows);
    }

    private static (string Html, string Plain, List<List<(string Text, string Data)>> Buttons) BuildSearchPrompt()
    {
        return (
            "<b>请输入要搜索的模型名</b>",
            "请输入要搜索的模型名",
            new List<List<(string Text, string Data)>> { new() { ("🔙 返回", "mdl:back") } });
    }

    private static (string Html, string Plain, List<List<(string Text, string Data)>> Buttons) BuildTierMenu(AiChannel ch, int current)
    {
        var maxTier = Math.Clamp(ch.DefaultTier, 0, 3);
        var rows = new List<List<(string Text, string Data)>>();
        for (var t = 0; t <= maxTier; t++)
        {
            var mark = t == current ? " ✓" : "";
            rows.Add(new List<(string Text, string Data)> { ($"{TierName(t)}{mark}", $"tier:sel:{t}") });
        }
        rows.Add(new List<(string Text, string Data)> { ("🔙 返回", "help:back") });
        var html = $"<b>切换档位</b>\n当前：{HtmlEncode(TierName(current))}\n（仅可 ≤ 频道档位 {HtmlEncode(TierName(maxTier))}）";
        var plain = $"切换档位\n当前：{TierName(current)}\n（仅可 ≤ 频道档位 {TierName(maxTier)}）";
        return (html, plain, rows);
    }

    private (string Html, string Plain, List<List<(string Text, string Data)>> Buttons) BuildHelpMenu(AiChannel ch)
    {
        var (h, p) = BuildHelp(ch);
        var rows = new List<List<(string Text, string Data)>>
        {
            new()
            {
                ("🤖 模型", "help:model"),
                ("🎚 档位", "help:tier"),
                ("📊 状态", "help:status"),
            },
        };
        return (h, p, rows);
    }

    private async Task RefreshModelMenuAsync(AiChannel ch, string externalId, ModelMenuState state, CancellationToken ct)
    {
        var (html, plain, buttons) = BuildModelMenu(state);
        await AdapterFor(ch.ChannelType).EditMenuAsync(ch, externalId, state.MessageId, html, plain, buttons, ct);
    }

    public async Task HandleMenuCallbackAsync(ChannelMenuAction action, CancellationToken ct = default)
    {
        try
        {
            var ch = await GetChannelAsync(action.ChannelId, includeSecrets: false, ct);
            if (ch == null || !ch.Enabled) return;
            var adapter = AdapterFor(ch.ChannelType);
            var key = $"{ch.Id}|{action.ExternalId}";

            switch (action.Kind)
            {
                case "help-back":
                    {
                        var (hh, hp, hb) = BuildHelpMenu(ch);
                        await adapter.EditMenuAsync(ch, action.ChatId, action.MessageId, hh, hp, hb, ct);
                        break;
                    }
                case "help-model":
                    {
                        var state = await CreateModelMenuStateAsync(ch, ct);
                        if (state == null)
                        {
                            await adapter.EditMenuAsync(ch, action.ChatId, action.MessageId,
                                "⚠️ 未配置可用的 AI 供应商。", "⚠️ 未配置可用的 AI 供应商。", null, ct);
                            return;
                        }
                        state.MessageId = action.MessageId;
                        _modelMenus[key] = state;
                        var (mh, mp, mb) = BuildProviderMenu(state);
                        await adapter.EditMenuAsync(ch, action.ChatId, action.MessageId, mh, mp, mb, ct);
                        break;
                    }
                case "help-tier":
                    {
                        var user = await _channelUsers.FirstOrDefaultAsync(
                            x => x.ChannelId == ch.Id && x.ExternalId == action.ExternalId, ct);
                        if (user == null)
                        {
                            await adapter.EditMenuAsync(ch, action.ChatId, action.MessageId,
                                "请先绑定控制台账号（/bind 绑定码）。", "请先绑定控制台账号（/bind 绑定码）。", null, ct);
                            return;
                        }
                        var current = Math.Clamp(user.TierOverride ?? ch.DefaultTier, 0, 3);
                        var (th, tp, tb) = BuildTierMenu(ch, current);
                        await adapter.EditMenuAsync(ch, action.ChatId, action.MessageId, th, tp, tb, ct);
                        break;
                    }
                case "help-status":
                    {
                        var user = await _channelUsers.FirstOrDefaultAsync(
                            x => x.ChannelId == ch.Id && x.ExternalId == action.ExternalId, ct);
                        var tier = user == null ? ch.DefaultTier : Math.Clamp(user.TierOverride ?? ch.DefaultTier, 0, 3);
                        var bound = user == null ? "未绑定" : user.BoundUserName;
                        var session = await _ai.GetChannelSessionByExternalAsync(ch.Id, action.ExternalId, ct);
                        var model = session?.Model ?? "";
                        await adapter.EditMenuAsync(ch, action.ChatId, action.MessageId,
                            $"绑定：<b>{HtmlEncode(bound)}</b>\n档位：<b>{HtmlEncode(TierName(tier))}</b>\n模型：<code>{HtmlEncode(model)}</code>",
                            $"绑定：{bound}\n档位：{TierName(tier)}\n模型：{model}",
                            new List<List<(string Text, string Data)>> { new() { ("🔙 返回", "help:back") } }, ct);
                        break;
                    }
                case "model-provider":
                    {
                        if (!_modelMenus.TryGetValue(key, out var st) || st.ExpiresAt <= DateTime.UtcNow
                            || !int.TryParse(action.Data, out var idx) || idx < 0 || idx >= st.Providers.Count)
                        {
                            await NotifyMenuStaleAsync(ch, action, ct);
                            return;
                        }
                        st.ProviderIndex = idx;
                        st.Models = (await _ai.GetProvidersAsync(ct))
                            .FirstOrDefault(p => p.Id == st.Providers[idx].Id)?.Models ?? new List<string>();
                        st.Query = null;
                        st.Page = 0;
                        var (mh, mp, mb) = BuildModelMenu(st);
                        await adapter.EditMenuAsync(ch, action.ChatId, st.MessageId, mh, mp, mb, ct);
                        break;
                    }
                case "model-providers":
                    {
                        if (_modelMenus.TryGetValue(key, out var st) && st.ExpiresAt > DateTime.UtcNow)
                        {
                            var (ph, pp, pb) = BuildProviderMenu(st);
                            await adapter.EditMenuAsync(ch, action.ChatId, st.MessageId, ph, pp, pb, ct);
                        }
                        break;
                    }
                case "model-nav":
                    {
                        if (_modelMenus.TryGetValue(key, out var st) && st.ExpiresAt > DateTime.UtcNow
                            && int.TryParse(action.Data, out var page))
                        {
                            st.Page = page;
                            await RefreshModelMenuAsync(ch, action.ChatId, st, ct);
                        }
                        break;
                    }
                case "model-search":
                    {
                        if (_modelMenus.TryGetValue(key, out var st) && st.ExpiresAt > DateTime.UtcNow)
                        {
                            st.Searching = true;
                            var (sh, sp, sb) = BuildSearchPrompt();
                            await adapter.EditMenuAsync(ch, action.ChatId, st.MessageId, sh, sp, sb, ct);
                        }
                        break;
                    }
                case "model-back":
                    {
                        if (_modelMenus.TryGetValue(key, out var st) && st.ExpiresAt > DateTime.UtcNow)
                        {
                            st.Searching = false;
                            st.Query = null;
                            st.Page = 0;
                            await RefreshModelMenuAsync(ch, action.ChatId, st, ct);
                        }
                        break;
                    }
                case "model-select":
                    {
                        if (!_modelMenus.TryGetValue(key, out var st) || st.ExpiresAt <= DateTime.UtcNow
                            || !int.TryParse(action.Data, out var idx))
                        {
                            await NotifyMenuStaleAsync(ch, action, ct);
                            return;
                        }
                        var filtered = string.IsNullOrEmpty(st.Query)
                            ? st.Models
                            : st.Models.Where(m => m.Contains(st.Query, StringComparison.OrdinalIgnoreCase)).ToList();
                        if (idx < 0 || idx >= filtered.Count)
                        {
                            await NotifyMenuStaleAsync(ch, action, ct);
                            return;
                        }
                        var model = filtered[idx];
                        var session = await _ai.GetChannelSessionByExternalAsync(ch.Id, action.ExternalId, ct);
                        if (session != null) await _ai.UpdateSessionModelAsync(session.Id, model, ct);
                        _modelMenus.TryRemove(key, out _);
                        await adapter.EditMenuAsync(ch, action.ChatId, st.MessageId,
                            $"✅ 已切换模型：<code>{HtmlEncode(model)}</code>",
                            $"✅ 已切换模型：{model}", null, ct);
                        break;
                    }
                case "tier-select":
                    {
                        if (!int.TryParse(action.Data, out var tier)) return;
                        if (tier < 0 || tier > Math.Clamp(ch.DefaultTier, 0, 3))
                        {
                            await adapter.EditMenuAsync(ch, action.ChatId, action.MessageId,
                                "❌ 不能高于频道档位。", "❌ 不能高于频道档位。", null, ct);
                            return;
                        }
                        var ok = await SetUserTierByExternalAsync(ch.Id, action.ExternalId, tier, ct);
                        if (ok)
                        {
                            await adapter.EditMenuAsync(ch, action.ChatId, action.MessageId,
                                $"✅ 已切换档位：<b>{HtmlEncode(TierName(tier))}</b>",
                                $"✅ 已切换档位：{TierName(tier)}",
                                new List<List<(string Text, string Data)>> { new() { ("🔙 返回", "help:back") } }, ct);
                        }
                        break;
                    }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Menu callback failed (channel {Channel}, kind {Kind})", action.ChannelId, action.Kind);
        }
    }

    private async Task NotifyMenuStaleAsync(AiChannel ch, ChannelMenuAction action, CancellationToken ct)
    {
        await AdapterFor(ch.ChannelType).EditMenuAsync(ch, action.ChatId, action.MessageId,
            "菜单已过期，请重新发送 /model 打开。", "菜单已过期，请重新发送 /model 打开。", null, ct);
    }

    public async Task<bool> SetUserTierByExternalAsync(string channelId, string externalId, int tier, CancellationToken ct = default)
    {
        var ch = await GetChannelAsync(channelId, includeSecrets: false, ct);
        if (ch == null) return false;
        if (tier < 0 || tier > Math.Clamp(ch.DefaultTier, 0, 3))
            throw new ArgumentException($"tier must be ≤ channel default ({ch.DefaultTier})");
        var exists = await _channelUsers.ExistsAsync(
            x => x.ChannelId == channelId && x.ExternalId == externalId, ct);
        if (!exists) return false;
        await _channelUsers.UpdateOneAsync(
            x => x.ChannelId == channelId && x.ExternalId == externalId,
            new[] { new FieldUpdate(nameof(AiChannelUser.TierOverride), tier) },
            ct);
        return true;
    }

    /// <summary>
    /// </summary>
    private async Task TryResolveApprovalAsync(AiChannel ch, ChannelInboundMessage msg, bool approved, string permit, CancellationToken ct)
    {
        var session = await _ai.GetChannelSessionByExternalAsync(ch.Id, msg.ExternalId, ct);
        if (session == null)
        {
            await TrySendAsync(ch, Target(msg), "当前没有挂起的审批。", ct);
            return;
        }
        var pending = await _ai.GetPendingApprovalAsync(session.Id, session.UserId, ct);
        if (pending == null)
        {
            await TrySendAsync(ch, Target(msg), "当前没有挂起的审批。", ct);
            return;
        }
        var callId = pending["id"]?.GetValue<string>() ?? "";
        if (callId.Length == 0)
        {
            await TrySendAsync(ch, Target(msg), "审批状态异常，请在控制台处理。", ct);
            return;
        }
        var ok = await _ai.ResolveApprovalAsync(session.Id, callId, approved, ct, permit);
        if (ok)
        {
            await AdapterFor(ch.ChannelType).DeleteApprovalMessageAsync(ch, session.Id, callId, ct);
        }
        await TrySendAsync(ch, Target(msg), ok
            ? (approved
                ? $"✅ 已批准（{permit}），AI 将继续执行。"
                : "已拒绝该调用。")
            : "审批已失效（可能已在控制台处理）。", ct);
    }

    private async Task TryBindAsync(AiChannel ch, ChannelInboundMessage msg, string code, CancellationToken ct)
    {
        var existing = await _channelUsers.FirstOrDefaultAsync(
            x => x.ChannelId == ch.Id && x.ExternalId == msg.ExternalId, ct);
        if (existing != null)
        {
            await TrySendRichAsync(ch, Target(msg),
                $"你已经绑定到账号 <b>{HtmlEncode(existing.BoundUserName)}</b>，无需重复绑定。",
                $"你已经绑定到账号「{existing.BoundUserName}」，无需重复绑定。", ct);
            return;
        }
        if (string.IsNullOrWhiteSpace(code))
        {
            await TrySendAsync(ch, Target(msg), "❌ 绑定码无效。", ct);
            return;
        }

        var now = DateTime.UtcNow;
        var hash = HashCode(code);
        var bc = await _bindCodes.FirstOrDefaultAsync(x => x.ChannelId == ch.Id && x.CodeHash == hash
                && x.ExpiresAt > now && x.UsedAt == null && x.RevokedAt == null, ct);
        if (bc == null)
        {
            await TrySendAsync(ch, Target(msg), "❌ 绑定码无效或已过期，请重新生成。", ct);
            return;
        }

        var mark = await _bindCodes.UpdateOneAsync(
            x => x.Id == bc.Id && x.UsedAt == null,
            new[]
            {
                new FieldUpdate(nameof(AiChannelBindCode.UsedAt), now),
                new FieldUpdate(nameof(AiChannelBindCode.UsedByExternalId), msg.ExternalId),
                new FieldUpdate(nameof(AiChannelBindCode.UsedByExternalName), msg.ExternalName),
            },
            ct);
        if (mark == 0)
        {
            await TrySendAsync(ch, Target(msg), "❌ 绑定码已被使用，请重新生成。", ct);
            return;
        }

        await _channelUsers.InsertAsync(new AiChannelUser
        {
            ChannelId = ch.Id,
            ExternalId = msg.ExternalId,
            ExternalName = msg.ExternalName,
            BoundUserId = bc.BoundUserId,
            BoundUserName = bc.BoundUserName,
        }, ct);
        await _audit.LogAsync(bc.BoundUserId, bc.BoundUserName, "AI channel bind", "ai.channel.bind", null,
            $"channel={ch.Id} type={ch.ChannelType} external={msg.ExternalId} ({msg.ExternalName})",
            "channel", RiskLevel.Safe);
        var tier = Math.Clamp(ch.DefaultTier, 0, 3);
        await TrySendRichAsync(ch, Target(msg),
            $"✅ 绑定成功：<b>{HtmlEncode(bc.BoundUserName)}</b>\n当前档位：<b>{HtmlEncode(TierName(tier))}</b>\n发送 /help 查看可用指令。",
            $"✅ 绑定成功：{bc.BoundUserName}\n当前档位：{TierName(tier)}\n发送 /help 查看可用指令。", ct);
    }

    private async Task RunChatAsync(
        AiChannel ch, ChannelInboundMessage msg,
        string userId, string userName, int tier, bool guest, CancellationToken ct)
    {
        var (providerId, model, _) = await ResolveProviderAsync(ch, ct);
        if (providerId == null)
        {
            await TrySendAsync(ch, Target(msg), "⚠️ 未配置可用的 AI 供应商", ct);
            return;
        }

        var session = await _ai.GetOrCreateChannelSessionAsync(
            ch.Id, ch.ChannelType, msg.ExternalId, msg.ExternalName, userId, userName, providerId, model, ct);
        if (session.ChannelExternalName != msg.ExternalName || session.UserName != userName)
            await _ai.UpdateChannelSessionIdentityAsync(session.Id, msg.ExternalName, userName, ct);

        var gate = _gates.GetOrAdd($"run|{ch.Id}|{msg.ExternalId}", _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            long thinkingMessageId = 0;
            if (ch.ChannelType == AiChannelTypes.Telegram)
            {
                try
                {
                    thinkingMessageId = await _telegram.StartStreamAsync(ch, Target(msg), NextThinkingPhrase(), ct);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Telegram thinking message send failed ({Channel})", ch.Id);
                    thinkingMessageId = 0;
                }
            }
            var typing = ch.ChannelType == AiChannelTypes.WechatClaw
                ? StartWeChatTypingAsync(ch, msg, ct)
                : Task.CompletedTask;
            try
            {
                await _ai.RunChatAsync(session, msg.Text,
                    BuildSink(ch, msg, session.Id, guest, thinkingMessageId, ct), ct, (JustitiaTier)tier);
            }
            finally
            {
                if (ch.ChannelType == AiChannelTypes.WechatClaw)
                {
                    try { await typing; } catch { }
                    await StopWeChatTypingAsync(ch, msg, ct);
                }
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task StartWeChatTypingAsync(AiChannel ch, ChannelInboundMessage msg, CancellationToken ct)
    {
        var adapter = (WeChatClawAdapter)AdapterFor(ch.ChannelType);
        if (!await adapter.SendTypingAsync(ch, msg.ExternalId, start: true, ct)) return;
        var running = true;
        _ = Task.Run(async () =>
        {
            try
            {
                while (running)
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), ct);
                    if (!running) break;
                    await adapter.SendTypingAsync(ch, msg.ExternalId, start: true, ct);
                }
            }
            catch (OperationCanceledException) { }
            catch { }
        }, ct);
        _typingKeepalives[ch.Id + "|" + msg.ExternalId] = new Action(() => { running = false; });
    }

    private async Task StopWeChatTypingAsync(AiChannel ch, ChannelInboundMessage msg, CancellationToken ct)
    {
        if (_typingKeepalives.TryRemove(ch.Id + "|" + msg.ExternalId, out var stop)) stop();
        var adapter = (WeChatClawAdapter)AdapterFor(ch.ChannelType);
        try { await adapter.SendTypingAsync(ch, msg.ExternalId, start: false, ct); }
        catch (Exception ex) { _logger.LogDebug(ex, "WeChat typing stop failed ({Channel})", ch.Id); }
    }

    private async Task<(string? ProviderId, string Model, List<string> Models)> ResolveProviderAsync(AiChannel ch, CancellationToken ct)
    {
        var providers = await _ai.GetProvidersAsync(ct);
        var enabled = providers.Where(p => p.Enabled && p.Models.Count > 0).ToList();
        if (enabled.Count == 0) return (null, "", new List<string>());
        var p = enabled.FirstOrDefault(x => x.Id == ch.DefaultProviderId) ?? enabled[0];
        var model = ch.DefaultModel.Length > 0 && p.Models.Contains(ch.DefaultModel)
            ? ch.DefaultModel
            : (p.DefaultModel.Length > 0 ? p.DefaultModel : p.Models[0]);
        return (p.Id, model, p.Models);
    }


    /// <summary>
    /// </summary>
    private Func<string, Task> BuildSink(AiChannel ch, ChannelInboundMessage msg, string sessionId, bool guest, long initialStreamMessageId, CancellationToken ct)
    {
        var sb = new StringBuilder();
        var showToolCalls = ch.ShowToolCalls;
        var stream = ch.StreamOutput || ch.ChannelType == AiChannelTypes.Telegram;
        long streamMessageId = initialStreamMessageId;
        var streamLock = new object();
        var lastFlush = DateTime.MinValue;
        var minFlushInterval = TimeSpan.FromMilliseconds(600);

        async Task FlushStreamAsync(bool force = false)
        {
            string text;
            lock (streamLock)
            {
                if (!force && DateTime.UtcNow - lastFlush < minFlushInterval) return;
                lastFlush = DateTime.UtcNow;
                text = sb.ToString().Trim();
            }
            if (text.Length == 0) return;
            try
            {
                if (streamMessageId == 0)
                {
                    if (text.Length > ChunkSize)
                    {
                        await TrySendAsync(ch, Target(msg), text, ct);
                        lock (streamLock) sb.Clear();
                        return;
                    }
                    streamMessageId = await AdapterFor(ch.ChannelType).StartStreamAsync(ch, Target(msg), text, ct);
                    if (streamMessageId == 0)
                    {
                        lock (streamLock) sb.Clear();
                    }
                }
                else
                {
                    if (text.Length > ChunkSize)
                    {
                        await TrySendAsync(ch, Target(msg), text, ct);
                        streamMessageId = 0;
                        lock (streamLock) sb.Clear();
                        return;
                    }
                    await AdapterFor(ch.ChannelType).UpdateStreamAsync(ch, Target(msg), streamMessageId, text, ct);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Channel stream send failed ({Channel} → {External})", ch.Id, msg.ExternalId);
                streamMessageId = 0;
            }
        }

        async Task DeleteThinkingMessageAsync()
        {
            if (streamMessageId == 0) return;
            try
            {
                await AdapterFor(ch.ChannelType).DeleteMessageAsync(ch, Target(msg), streamMessageId, ct);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Delete thinking message failed ({Channel} → {External})", ch.Id, msg.ExternalId);
            }
            streamMessageId = 0;
        }

        return async payload =>
        {
            JsonObject? evt;
            try { evt = JsonNode.Parse(payload) as JsonObject; }
            catch { return; }
            if (evt == null) return;

            var type = evt["type"]?.GetValue<string>() ?? "";
            switch (type)
            {
                case "message":
                    {
                        var delta = evt["delta"]?.GetValue<string>() ?? "";
                        if (delta.Length == 0) break;
                        lock (sb) sb.Append(delta);
                        if (stream) await FlushStreamAsync();
                        break;
                    }
                case "reasoning":
                    break;
                case "tool_call":
                    {
                        if (!showToolCalls) break;
                        var toolName = evt["toolCall"]?["toolName"]?.GetValue<string>() ?? "";
                        lock (sb) sb.Append("\n\n🔧 调用工具：").Append(toolName);
                        if (stream) await FlushStreamAsync(force: true);
                        break;
                    }
                case "tool_result":
                    if (!showToolCalls) break;
                    if (evt["state"]?.GetValue<string>() == "error")
                    {
                        lock (sb) sb.Append("\n\n⚠️ 工具执行失败");
                        if (stream) await FlushStreamAsync(force: true);
                    }
                    break;
                case "approval":
                    {
                        if (stream) await FlushStreamAsync(force: true);
                        var toolName = evt["toolCall"]?["toolName"]?.GetValue<string>() ?? "";
                        var callId = evt["toolCall"]?["id"]?.GetValue<string>() ?? "";
                        var args = evt["toolCall"]?["argsText"]?.GetValue<string>() ?? "";
                        var toolPretty = PrettyName(toolName);
                        var (argsHtml, argsPlain) = FormatApprovalArgs(args);
                        var approvalHtml = $"⏳ <b>审批请求</b>：\n工具：<b>{HtmlEncode(toolPretty)}</b>{argsHtml}";
                        var approvalPlain = $"⏳ 审批请求：\n工具：{toolPretty}{argsPlain}";
                        if (guest || callId.Length == 0)
                        {
                            var guide = "\n\n回复 /approve 批准（或 /approve 5min 临时许可 5 分钟），/reject 拒绝。";
                            await TrySendRichAsync(ch, Target(msg), approvalHtml + guide, approvalPlain + guide, ct);
                        }
                        else
                        {
                            await TrySendApprovalAsync(ch, Target(msg), approvalHtml, approvalPlain, sessionId, callId, ct);
                        }
                        await NotifyConsoleAsync(new
                        {
                            kind = "approval",
                            sessionId,
                            channelId = ch.Id,
                            channelType = ch.ChannelType,
                            externalName = msg.ExternalName,
                            toolName,
                        }, ct);
                        if (guest && callId.Length > 0)
                        {
                            var cid = callId;
                            var sid = sessionId;
                            _ = Task.Run(async () =>
                            {
                                try
                                {
                                    await Task.Delay(3000, ct);
                                    await _ai.ResolveApprovalAsync(sid, cid, false, ct);
                                    await AdapterFor(ch.ChannelType).DeleteApprovalMessageAsync(ch, sid, cid, ct);
                                }
                                catch { /* run may have been cancelled */ }
                            }, ct);
                        }
                        break;
                    }
                case "done":
                    {
                        if (stream && streamMessageId != 0)
                        {
                            bool hasText;
                            lock (sb) { hasText = sb.ToString().Trim().Length > 0; }
                            if (!hasText)
                            {
                                await DeleteThinkingMessageAsync();
                                break;
                            }
                            await FlushStreamAsync(force: true);
                            break;
                        }
                        string text;
                        lock (sb) { text = sb.ToString().Trim(); sb.Clear(); }
                        if (text.Length > 0)
                            await TrySendAsync(ch, Target(msg), text, ct);
                        break;
                    }
                case "error":
                    {
                        string partial;
                        lock (sb) { partial = sb.ToString().Trim(); sb.Clear(); }
                        var err = evt["message"]?.GetValue<string>() ?? "未知错误";
                        if (stream && streamMessageId != 0)
                            await DeleteThinkingMessageAsync();
                        var reply = partial.Length > 0 ? $"{partial}\n\n❌ {err}" : $"❌ {err}";
                        await TrySendAsync(ch, Target(msg), reply, ct);
                        break;
                    }
            }
        };
    }

    private async Task TrySendAsync(AiChannel ch, string externalId, string text, CancellationToken ct)
    {
        try
        {
            await SendChunkedAsync(AdapterFor(ch.ChannelType), ch, externalId, text, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Channel send failed ({Channel} → {External})", ch.Id, externalId);
        }
    }

    private async Task TrySendApprovalAsync(AiChannel ch, string externalId, string html, string plain, string sessionId, string callId, CancellationToken ct)
    {
        try
        {
            await AdapterFor(ch.ChannelType).SendApprovalAsync(ch, externalId, html, plain, sessionId, callId, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Channel approval send failed ({Channel} → {External})", ch.Id, externalId);
        }
    }

    public async Task SendMediaToChannelAsync(
        string channelId, string externalId, string type, string url, string? fileName, string? caption, CancellationToken ct = default)
    {
        var ch = await GetChannelAsync(channelId, includeSecrets: true, ct)
            ?? throw new InvalidOperationException("channel not found");
        if (!ch.Enabled) throw new InvalidOperationException("channel disabled");
        var media = new ChannelMedia
        {
            Type = type,
            Url = url,
            FileName = fileName,
            Caption = caption,
        };
        await AdapterFor(ch.ChannelType).SendMediaAsync(ch, externalId, media, ct);
    }

    public async Task SendChannelTextAsync(string channelId, string externalId, string text, CancellationToken ct = default)
    {
        var ch = await GetChannelAsync(channelId, includeSecrets: true, ct)
            ?? throw new InvalidOperationException("channel not found");
        if (!ch.Enabled) throw new InvalidOperationException("channel disabled");
        await AdapterFor(ch.ChannelType).SendTextAsync(ch, externalId, text, ct);
    }

    public async Task<AiChannelUser?> GetLatestBoundUserAsync(string channelId, CancellationToken ct = default)
    {
        var list = await _channelUsers.FindPagedAsync(
            x => x.ChannelId == channelId, 1, 1, nameof(AiChannelUser.LastSeenAt), true, ct);
        return list.Count > 0 ? list[0] : null;
    }

    public async Task<CallbackResult> HandleCallbackAsync(CallbackAction action, CancellationToken ct = default)
    {
        try
        {
            var ok = await _ai.ResolveApprovalAsync(action.SessionId, action.ToolCallId, action.Approved, ct, action.Permit);
            return ok
                ? new CallbackResult(true)
                : new CallbackResult(false, "审批已失效（可能已在控制台或 IM 中处理）");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Approval callback failed (session {Session})", action.SessionId);
            return new CallbackResult(false, ex.Message);
        }
    }

    private static async Task SendChunkedAsync(IAiChannelAdapter adapter, AiChannel ch, string externalId, string text, CancellationToken ct)
    {
        // AI replies go out as Markdown (rendered by Telegram; plain text elsewhere).
        if (text.Length <= ChunkSize)
        {
            await adapter.SendMarkdownAsync(ch, externalId, text, ct);
            return;
        }
        var buf = new StringBuilder();
        foreach (var line in text.Split('\n'))
        {
            if (buf.Length + line.Length + 1 > ChunkSize && buf.Length > 0)
            {
                await adapter.SendMarkdownAsync(ch, externalId, buf.ToString().TrimEnd(), ct);
                buf.Clear();
            }
            buf.AppendLine(line);
        }
        if (buf.Length > 0)
            await adapter.SendMarkdownAsync(ch, externalId, buf.ToString().TrimEnd(), ct);
    }

    private async Task NotifyConsoleAsync(object data, CancellationToken ct)
    {
        try
        {
            var msg = new WebSocketMessage
            {
                Type = "ai.channel",
                Channel = "console",
                Data = JsonSerializer.SerializeToElement(data),
            };
            await _ws.BroadcastToConsoleAsync(msg, ct);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Console broadcast failed");
        }
    }


    private static string HtmlEncode(string s) =>
        System.Net.WebUtility.HtmlEncode(s);

    private static string PrettyName(string raw) =>
        string.Join(' ', (raw ?? "").Split('_', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(w => w.Length > 0 ? char.ToUpperInvariant(w[0]) + w[1..] : w));

    private static string TierName(int tier) => tier switch
    {
        0 => "Cognitio 审理",
        1 => "Arbitrium 裁量",
        2 => "Imperium 治权",
        3 => "Dictatura 独裁",
        _ => "Cognitio 审理",
    };

    private async Task TrySendRichAsync(AiChannel ch, string externalId, string html, string plain, CancellationToken ct)
    {
        try
        {
            await AdapterFor(ch.ChannelType).SendRichTextAsync(ch, externalId, html, plain, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Channel rich send failed ({Channel} → {External})", ch.Id, externalId);
        }
    }

    private (string Html, string Plain) BuildHelp(AiChannel ch)
    {
        var tier = TierName(Math.Clamp(ch.DefaultTier, 0, 3));
        var isTelegram = ch.ChannelType == AiChannelTypes.Telegram;
        var commands = new List<(string Cmd, string Desc)>
        {
            ("/start", "开始使用"),
            ("/help", "显示本帮助"),
            ("/status", "查看绑定与档位"),
            ("/bind 绑定码", "绑定控制台账号"),
        };
        if (isTelegram)
        {
            commands.Add(("/model", "切换模型"));
            commands.Add(("/tier", "档位"));
        }
        else
        {
            commands.Add(("/approve [one-time|5min|20min]", "批准工具调用"));
            commands.Add(("/reject", "拒绝工具调用"));
        }
        var htmlLines = commands.Select(c => $"<code>{HtmlEncode(c.Cmd)}</code> — {HtmlEncode(c.Desc)}");
        var plainLines = commands.Select(c => $"{c.Cmd} — {c.Desc}");
        var html =
            $"目前权限档位：<b>{HtmlEncode(tier)}</b>\n\n" +
            "<b>可用指令：</b>\n" +
            string.Join("\n", htmlLines) + "\n\n" +
            "直接发送消息即可与我对话。";
        var plain =
            $"目前权限档位：{tier}\n\n" +
            "可用指令：\n" +
            string.Join("\n", plainLines) + "\n\n" +
            "直接发送消息即可与我对话。";
        return (html, plain);
    }

    private (string Html, string Plain) BuildBindHelp(AiChannel ch)
    {
        var html =
            "🔒 该频道需要绑定控制台账号后才能使用。\n" +
            "请在控制台「设置 → AI 频道」中由管理员生成绑定码，然后在此发送：\n" +
            "<code>/bind 绑定码</code>\n\n" +
            "绑定后即可与 Justitia 对话。";
        var plain =
            "🔒 该频道需要绑定控制台账号后才能使用。\n" +
            "请在控制台「设置 → AI 频道」中由管理员生成绑定码，然后在此发送：\n" +
            "/bind 绑定码\n\n" +
            "绑定后即可与 Justitia 对话。";
        return (html, plain);
    }

    /// <summary>
    /// </summary>
    private static (string Html, string Plain) FormatApprovalArgs(string argsText)
    {
        try
        {
            var obj = JsonNode.Parse(argsText) as JsonObject;
            if (obj == null || obj.Count == 0) return ("", "");
            var htmlLines = new List<string>();
            var plainLines = new List<string>();
            foreach (var kv in obj)
            {
                if (kv.Key.Equals("agentId", StringComparison.OrdinalIgnoreCase)) continue;
                var value = kv.Value?.GetValue<string>()
                    ?? (kv.Value is JsonValue jv ? jv.ToJsonString() : "")
                    ?? "";
                if (value.Length > 200) value = value[..200] + "…";
                htmlLines.Add($"<code>{HtmlEncode(PrettyName(kv.Key))}</code>: {HtmlEncode(value)}");
                plainLines.Add($"{PrettyName(kv.Key)}: {value}");
            }
            if (htmlLines.Count == 0) return ("", "");
            return ("\n参数：\n" + string.Join("\n", htmlLines), "\n参数：\n" + string.Join("\n", plainLines));
        }
        catch
        {
            return ("", "");
        }
    }
}
