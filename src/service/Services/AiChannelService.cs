using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

/// <summary>
/// AI 频道网关：IM 接入（Telegram / 飞书 / 微信 Claw）的统一入口。
/// 职责：频道配置 CRUD、一次性绑定码、入站消息管线（限流 → 命令 → 身份解析 → 会话路由 →
/// 复用 AiService.RunChatAsync 的聊天/工具/审批管线，事件出口换成 ChannelSink 回发 IM）。
/// 权限：频道会话的 Justitia 档位由服务端强制（频道默认档位 + 用户覆盖），不信任客户端；
/// 审批永远发生在控制台（复用现有 /api/ai/chat/action 门闩），频道只是展示端。
/// </summary>
public class AiChannelService
{
    private const int RateLimitWindowSec = 60;
    private const int RateLimitMax = 10;
    private const int MaxMessageLength = 2000;
    private const int ChunkSize = 3500;
    private const string SecretSentinel = "********";
    private const string GuestPrefix = "ch:guest:";

    private readonly MongoDbContext _db;
    private readonly AiService _ai;
    private readonly AuditService _audit;
    private readonly ConnectionManager _ws;
    private readonly Repository<User> _users;
    private readonly TelegramChannelAdapter _telegram;
    private readonly LarkChannelAdapter _lark;
    private readonly WeChatClawAdapter _claw;
    private readonly ILogger<AiChannelService> _logger;

    /// <summary>限流桶：(channelId|externalId) → 时间戳队列。</summary>
    private readonly ConcurrentDictionary<string, Queue<DateTime>> _rateBuckets = new();
    /// <summary>每用户运行闸：(channelId|externalId) → 同时只允许一个运行。</summary>
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _gates = new();

    public AiChannelService(
        MongoDbContext db,
        AiService ai,
        AuditService audit,
        ConnectionManager ws,
        Repository<User> users,
        TelegramChannelAdapter telegram,
        LarkChannelAdapter lark,
        WeChatClawAdapter claw,
        ILogger<AiChannelService> logger)
    {
        _db = db;
        _ai = ai;
        _audit = audit;
        _ws = ws;
        _users = users;
        _telegram = telegram;
        _lark = lark;
        _claw = claw;
        _logger = logger;
    }

    private IMongoCollection<AiChannel> Channels => _db.GetCollection<AiChannel>("ai_channels");
    private IMongoCollection<AiChannelUser> ChannelUsers => _db.GetCollection<AiChannelUser>("ai_channel_users");
    private IMongoCollection<AiChannelBindCode> BindCodes => _db.GetCollection<AiChannelBindCode>("ai_channel_bind_codes");
    private IMongoCollection<AiChannelCursor> Cursors => _db.GetCollection<AiChannelCursor>("ai_channel_cursors");

    /// <summary>幂等去重表：channelId|dedupeKey → 首次看到时间（防并发循环/重启重放）。</summary>
    private readonly ConcurrentDictionary<string, DateTime> _seenInbound = new();
    private const int SeenInboundMax = 2000;
    private static readonly TimeSpan SeenInboundTtl = TimeSpan.FromMinutes(30);

    /// <summary>模型菜单状态（供应商 → 模型 两级、分页/搜索）：channelId|externalId → 状态。</summary>
    private readonly ConcurrentDictionary<string, ModelMenuState> _modelMenus = new();
    private const int ModelMenuPageSize = 5;

    private sealed class ModelMenuState
    {
        /// <summary>可用供应商（id, name）。</summary>
        public List<(string Id, string Name)> Providers { get; set; } = new();
        /// <summary>当前选中的供应商索引；-1 = 显示供应商选择页。</summary>
        public int ProviderIndex { get; set; } = -1;
        /// <summary>当前供应商的模型列表。</summary>
        public List<string> Models { get; set; } = new();
        public string CurrentModel { get; set; } = "";
        public int Page { get; set; }
        public string? Query { get; set; }
        /// <summary>等待用户发送搜索关键词（下一条文本消息被拦截为搜索词）。</summary>
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

    // ── 配置加解密 / 打码 ────────────────────────────────────────────────

    /// <summary>API 出参打码：敏感键值替换为哨兵。</summary>
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
            _ => new[] { "clawBaseUrl" },
        };
        foreach (var k in required)
            if (!ch.Config.TryGetValue(k, out var v) || string.IsNullOrWhiteSpace(v) || v == SecretSentinel)
                throw new ArgumentException($"缺少配置项 {k}");
        if (ch.DefaultTier is < 0 or > 3) ch.DefaultTier = 0;
    }

    // ── 频道 CRUD ───────────────────────────────────────────────────────

    public async Task<List<AiChannel>> ListChannelsAsync(bool includeSecrets, CancellationToken ct = default)
    {
        var list = await Channels.Find(FilterDefinition<AiChannel>.Empty)
            .Sort(Builders<AiChannel>.Sort.Descending(c => c.CreatedAt)).ToListAsync(ct);
        foreach (var ch in list)
        {
            if (includeSecrets) DecryptSensitive(ch); else MaskConfig(ch);
        }
        return list;
    }

    public async Task<AiChannel?> GetChannelAsync(string id, bool includeSecrets, CancellationToken ct = default)
    {
        var ch = await Channels.Find(x => x.Id == id).FirstOrDefaultAsync(ct);
        if (ch == null) return null;
        if (includeSecrets) DecryptSensitive(ch); else MaskConfig(ch);
        return ch;
    }

    public async Task<List<AiChannel>> GetEnabledChannelsAsync(IEnumerable<string>? types = null, CancellationToken ct = default)
    {
        var filter = Builders<AiChannel>.Filter.Eq(c => c.Enabled, true);
        if (types != null)
        {
            var list = types.ToList();
            if (list.Count > 0) filter &= Builders<AiChannel>.Filter.In(c => c.ChannelType, list);
        }
        var result = await Channels.Find(filter).ToListAsync(ct);
        foreach (var ch in result) DecryptSensitive(ch);
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
        Validate(ch);
        EncryptSensitive(ch);
        await Channels.InsertOneAsync(ch, cancellationToken: ct);
        MaskConfig(ch);
        return ch;
    }

    public async Task<bool> UpdateChannelAsync(string id, AiChannel input, CancellationToken ct = default)
    {
        var existing = await GetChannelAsync(id, includeSecrets: true, ct);
        if (existing == null) return false;

        // 敏感键为哨兵/空 → 保留原值。
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
        Validate(ch);
        EncryptSensitive(ch);
        var r = await Channels.ReplaceOneAsync(x => x.Id == id, ch, cancellationToken: ct);
        return r.MatchedCount > 0;
    }

    public async Task<bool> DeleteChannelAsync(string id, CancellationToken ct = default)
    {
        var r = await Channels.DeleteOneAsync(x => x.Id == id, ct);
        if (r.DeletedCount == 0) return false;
        await ChannelUsers.DeleteManyAsync(x => x.ChannelId == id, ct);
        await BindCodes.DeleteManyAsync(x => x.ChannelId == id, ct);
        await DeletePollCursorAsync(id, ct);
        await _ai.DeleteChannelSessionsAsync(id, ct);
        return true;
    }

    /// <summary>连通性自检（设置页"测试连接"）。</summary>
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
            // 哨兵值（编辑态未改动的密钥）无法测试——由控制器在调用前用已解密配置补齐。
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

    /// <summary>绑定用户自己的频道会话（委托 AiService，控制台 AI 页"频道会话"分区）。</summary>
    public Task<List<AiSession>> MyChannelSessionsAsync(string userId, CancellationToken ct = default)
        => _ai.GetChannelSessionsAsync(userId, ct);

    /// <summary>轮询型频道拉取增量（由 ChannelPollingHostedService 驱动，按类型分发到适配器）。</summary>
    public Task<ChannelPollBatch> PollChannelAsync(AiChannel channel, string? cursor, CancellationToken ct = default)
        => AdapterFor(channel.ChannelType).PollAsync(channel, cursor, ct);

    /// <summary>读取频道轮询游标（服务重启后恢复，避免重放 24h 内消息）。</summary>
    public async Task<string> GetPollCursorAsync(string channelId, CancellationToken ct = default)
    {
        var c = await Cursors.Find(x => x.ChannelId == channelId).FirstOrDefaultAsync(ct);
        return c?.Cursor ?? "";
    }

    /// <summary>持久化频道轮询游标（upsert）。</summary>
    public async Task SetPollCursorAsync(string channelId, string cursor, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(cursor)) return;
        var existing = await Cursors.Find(x => x.ChannelId == channelId).FirstOrDefaultAsync(ct);
        if (existing == null)
        {
            await Cursors.InsertOneAsync(new AiChannelCursor { ChannelId = channelId, Cursor = cursor }, cancellationToken: ct);
        }
        else
        {
            await Cursors.UpdateOneAsync(
                x => x.Id == existing.Id,
                Builders<AiChannelCursor>.Update
                    .Set(c => c.Cursor, cursor)
                    .Set(c => c.UpdatedAt, DateTime.UtcNow),
                cancellationToken: ct);
        }
    }

    /// <summary>删除频道的轮询游标（频道删除时清理）。</summary>
    public async Task DeletePollCursorAsync(string channelId, CancellationToken ct = default)
    {
        await Cursors.DeleteManyAsync(x => x.ChannelId == channelId, ct);
    }

    // ── 绑定码 / 绑定用户 ────────────────────────────────────────────────

    private static readonly char[] CodeAlphabet =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray(); // 去除 0/O/1/I

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
    /// 管理员为指定控制台账号生成一次性绑定码（15 分钟有效，只存哈希）。
    /// bindUrl：Telegram 频道的深链绑定链接（t.me/{bot}?start=CODE），点击即触发 /start CODE。
    /// </summary>
    public async Task<(string Code, DateTime ExpiresAt, string? BindUrl)> CreateBindCodeAsync(
        string channelId, string boundUserId, CancellationToken ct = default)
    {
        var ch = await Channels.Find(x => x.Id == channelId).FirstOrDefaultAsync(ct)
            ?? throw new KeyNotFoundException("channel not found");
        var user = await _users.GetByIdAsync(boundUserId, ct)
            ?? throw new KeyNotFoundException("user not found");
        var code = GenerateBindCode();
        var expiresAt = DateTime.UtcNow.AddMinutes(15);
        await BindCodes.InsertOneAsync(new AiChannelBindCode
        {
            ChannelId = channelId,
            BoundUserId = user.Id,
            BoundUserName = user.Username,
            CodeHash = HashCode(code),
            CodeTail = code.Length >= 4 ? code[^4..] : code,
            ExpiresAt = expiresAt,
        }, cancellationToken: ct);
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
        return await ChannelUsers.Find(x => x.ChannelId == channelId)
            .Sort(Builders<AiChannelUser>.Sort.Descending(u => u.BoundAt)).ToListAsync(ct);
    }

    /// <summary>列出频道的全部绑定码（新→旧）。</summary>
    public async Task<List<AiChannelBindCode>> ListBindCodesAsync(string channelId, CancellationToken ct = default)
    {
        return await BindCodes.Find(x => x.ChannelId == channelId)
            .Sort(Builders<AiChannelBindCode>.Sort.Descending(b => b.CreatedAt)).ToListAsync(ct);
    }

    /// <summary>作废一个未使用的绑定码（已使用的不可作废）。返回 false 表示不存在或已使用。</summary>
    public async Task<bool> RevokeBindCodeAsync(string channelId, string codeId, CancellationToken ct = default)
    {
        var r = await BindCodes.UpdateOneAsync(
            x => x.Id == codeId && x.ChannelId == channelId && x.UsedAt == null && x.RevokedAt == null,
            Builders<AiChannelBindCode>.Update.Set(b => b.RevokedAt, DateTime.UtcNow),
            cancellationToken: ct);
        if (r.MatchedCount == 0) return false;
        var bc = await BindCodes.Find(x => x.Id == codeId).FirstOrDefaultAsync(ct);
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
        var upd = Builders<AiChannelUser>.Update.Set(u => u.TierOverride, tier);
        var r = await ChannelUsers.UpdateOneAsync(x => x.Id == channelUserId, upd, cancellationToken: ct);
        return r.MatchedCount > 0;
    }

    public async Task<bool> UnbindUserAsync(string channelUserId, CancellationToken ct = default)
    {
        var u = await ChannelUsers.Find(x => x.Id == channelUserId).FirstOrDefaultAsync(ct);
        if (u == null) return false;
        var r = await ChannelUsers.DeleteOneAsync(x => x.Id == channelUserId, ct);
        if (r.DeletedCount > 0)
        {
            await _audit.LogAsync(u.BoundUserId, u.BoundUserName, "AI channel unbind", "ai.channel.unbind",
                null, $"channel={u.ChannelId} external={u.ExternalId} ({u.ExternalName})", "console", RiskLevel.Safe);
        }
        return r.DeletedCount > 0;
    }

    // ── 入站管线 ────────────────────────────────────────────────────────

    /// <summary>IM 入站消息统一入口（适配器轮询 / Webhook / 长连接均汇入此处）。</summary>
    public async Task HandleInboundAsync(ChannelInboundMessage msg, CancellationToken ct = default)
    {
        // 幂等去重：Telegram update_id / 飞书 event_id / iLink message_id。
        // 防御：并发轮询循环、重启后 Telegram 24h 重放、飞书未 ack 重推。
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
        if (ch == null || !ch.Enabled) return; // 未找到/停用频道：静默丢弃。

        var text = msg.Text.Trim();
        if (text.Length == 0) return;
        if (text.Length > MaxMessageLength) text = text[..MaxMessageLength] + "…";

        // 模型菜单搜索拦截：菜单处于"等待关键词"状态时，本条文本作为搜索词，
        // 不进入 AI 对话。删除用户发送的搜索词消息，并把提示消息编辑为搜索结果。
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

        // 群组权限：仅已绑定账户可对话；未绑定账户仅响应 /bind（绑定引导），
        // 其余群组消息静默忽略（不刷屏）。
        if (msg.IsGroup)
        {
            var bound = await ChannelUsers.Find(x => x.ChannelId == ch.Id && x.ExternalId == msg.ExternalId)
                .FirstOrDefaultAsync(ct);
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
        // 自定义键盘按钮别名（/start 的常驻键盘：点击发送纯文本按钮词）。
        var alias = text.Trim().ToLowerInvariant();
        if (alias is "help" or "start")
        {
            await HandleCommandAsync(ch, msg, "/" + alias, ct);
            return;
        }

        var user = await ChannelUsers.Find(x => x.ChannelId == ch.Id && x.ExternalId == msg.ExternalId)
            .FirstOrDefaultAsync(ct);
        if (user == null)
        {
            if (ch.RequireBind)
            {
                var (h, p) = BuildBindHelp(ch);
                await TrySendRichAsync(ch, Target(msg), h, p, ct);
                return;
            }
            // 访客模式（RequireBind=false）：会话归属合成用户，档位强制 Cognitio，
            // 超出档位的工具调用自动拒绝（控制台无人可审批）。
            await RunChatAsync(ch, msg, GuestUserId(ch.Id, msg.ExternalId), "guest", tier: 0, guest: true, ct);
            return;
        }

        // 已绑定：更新最后活跃与昵称（异步，不阻塞主流程）。
        _ = ChannelUsers.UpdateOneAsync(
            x => x.Id == user.Id,
            Builders<AiChannelUser>.Update
                .Set(u => u.LastSeenAt, DateTime.UtcNow)
                .Set(u => u.ExternalName, msg.ExternalName),
            cancellationToken: ct);

        var tier = Math.Clamp(user.TierOverride ?? ch.DefaultTier, 0, 3);
        var auditName = $"{user.BoundUserName}({ch.ChannelType}:{msg.ExternalName})";
        await RunChatAsync(ch, msg, user.BoundUserId, auditName, tier, guest: false, ct);
    }

    private static string GuestUserId(string channelId, string externalId) => $"{GuestPrefix}{channelId}:{externalId}";
    private static bool IsGuestUserId(string userId) => userId.StartsWith(GuestPrefix, StringComparison.Ordinal);

    /// <summary>消息的回复目标（发送地址）：群组 = 群 chat id；私聊 = 身份 id。</summary>
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
        // 群组命令常带 @bot 后缀（/help@LibraNT_Bot）：剥离后匹配。
        var atIdx = cmd.IndexOf('@');
        if (atIdx > 0) cmd = cmd[..atIdx];
        switch (cmd)
        {
            case "/start":
            {
                // 深链绑定：https://t.me/{bot}?start=CODE → Telegram 自动发送 /start CODE。
                if (parts.Length > 1)
                {
                    await TryBindAsync(ch, msg, parts[1], ct);
                    break;
                }
                // /start 只做简单介绍：Telegram 附带常驻键盘（Help），完整指令见 /help。
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
                    // 帮助消息附带快捷菜单（模型/档位/状态，一行三个）。
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
                var user = await ChannelUsers.Find(x => x.ChannelId == ch.Id && x.ExternalId == msg.ExternalId)
                    .FirstOrDefaultAsync(ct);
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
                // /tier：新发档位选择菜单（含返回）。
                if (ch.ChannelType != AiChannelTypes.Telegram)
                {
                    await TrySendAsync(ch, Target(msg), "该功能需要 Telegram 内联菜单支持。", ct);
                    break;
                }
                var tu = await ChannelUsers.Find(x => x.ChannelId == ch.Id && x.ExternalId == msg.ExternalId)
                    .FirstOrDefaultAsync(ct);
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
                // 保留文本审批命令（按钮失效时的兜底；非 Telegram 频道的主路径）。
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

    // ── 模型/档位菜单 ────────────────────────────────────────────────────

    /// <summary>/model：发送供应商选择菜单（点击供应商 → 选择模型）。</summary>
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

    /// <summary>创建模型菜单状态（供应商列表 + 默认供应商的模型）。返回 null 表示无可用供应商。</summary>
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

    /// <summary>供应商选择页：每行两个供应商按钮，最后一行返回。</summary>
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

    /// <summary>模型选择页：模型每行一个；导航行（上一页/搜索/下一页 同行）；返回行。</summary>
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

        // 导航行：上一页 / 搜索（常驻）/ 下一页，同一行并排。
        var nav = new List<(string Text, string Data)>();
        if (state.Page > 0) nav.Add(("◀️", $"mdl:nav:{state.Page - 1}"));
        nav.Add(("🔍 搜索", "mdl:sea"));
        if (state.Page < pages - 1) nav.Add(("▶️", $"mdl:nav:{state.Page + 1}"));
        rows.Add(nav);
        // 返回行。
        rows.Add(new List<(string Text, string Data)> { ("🔙 返回", "mdl:provs") });

        return (html.ToString(), plain.ToString(), rows);
    }

    /// <summary>搜索提示页（等待用户发送模型关键词）。</summary>
    private static (string Html, string Plain, List<List<(string Text, string Data)>> Buttons) BuildSearchPrompt()
    {
        return (
            "<b>请输入要搜索的模型名</b>",
            "请输入要搜索的模型名",
            new List<List<(string Text, string Data)>> { new() { ("🔙 返回", "mdl:back") } });
    }

    /// <summary>档位选择页：档位每行一个，最后一行返回。</summary>
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

    /// <summary>帮助页（快捷按钮一行三个）。</summary>
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

    /// <summary>刷新/编辑模型菜单（翻页、搜索后；编辑的是菜单消息本身）。</summary>
    private async Task RefreshModelMenuAsync(AiChannel ch, string externalId, ModelMenuState state, CancellationToken ct)
    {
        var (html, plain, buttons) = BuildModelMenu(state);
        await AdapterFor(ch.ChannelType).EditMenuAsync(ch, externalId, state.MessageId, html, plain, buttons, ct);
    }

    /// <summary>菜单按钮回调（供应商/模型分页/选择/搜索、档位、帮助快捷与返回）。</summary>
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
                    // 返回帮助页：编辑当前消息为帮助菜单。
                {
                    var (hh, hp, hb) = BuildHelpMenu(ch);
                    await adapter.EditMenuAsync(ch, action.ChatId, action.MessageId, hh, hp, hb, ct);
                    break;
                }
                case "help-model":
                    // 编辑 help 消息 → 供应商选择页。
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
                    // 编辑 help 消息 → 档位选择页。
                {
                    var user = await ChannelUsers.Find(x => x.ChannelId == ch.Id && x.ExternalId == action.ExternalId)
                        .FirstOrDefaultAsync(ct);
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
                    // 编辑 help 消息 → 状态页（含返回）。
                {
                    var user = await ChannelUsers.Find(x => x.ChannelId == ch.Id && x.ExternalId == action.ExternalId)
                        .FirstOrDefaultAsync(ct);
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
                    // 搜索提示页返回：清空搜索词，回到模型页。
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
                    // 更新会话模型（当前对话生效）。
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
                        // 服务端兜底：不允许高于频道档位。
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

    /// <summary>IM 用户自行切换档位：仅允许 ≤ 频道默认档位（防自行提权）。</summary>
    public async Task<bool> SetUserTierByExternalAsync(string channelId, string externalId, int tier, CancellationToken ct = default)
    {
        var ch = await GetChannelAsync(channelId, includeSecrets: false, ct);
        if (ch == null) return false;
        if (tier < 0 || tier > Math.Clamp(ch.DefaultTier, 0, 3))
            throw new ArgumentException($"tier must be ≤ channel default ({ch.DefaultTier})");
        var r = await ChannelUsers.UpdateOneAsync(
            x => x.ChannelId == channelId && x.ExternalId == externalId,
            Builders<AiChannelUser>.Update.Set(u => u.TierOverride, tier),
            cancellationToken: ct);
        return r.MatchedCount > 0;
    }

    /// <summary>
    /// IM 端审批决策：定位该外部用户自己的频道会话 → 取挂起调用 → 写入门闩。
    /// 批准后原运行经 ChannelSink 续跑并把最终结果推回 IM（与控制台审批同一条路径）。
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
            // 决策完成：删除审批消息（用户已批准/拒绝，无需保留；仅原生按钮频道生效）。
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
        var existing = await ChannelUsers.Find(x => x.ChannelId == ch.Id && x.ExternalId == msg.ExternalId)
            .FirstOrDefaultAsync(ct);
        if (existing != null)
        {
            // 已绑定：明确提示，避免误读为"绑定成功"。
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
        var bc = await BindCodes.Find(x => x.ChannelId == ch.Id && x.CodeHash == hash
                && x.ExpiresAt > now && x.UsedAt == null && x.RevokedAt == null).FirstOrDefaultAsync(ct);
        if (bc == null)
        {
            await TrySendAsync(ch, Target(msg), "❌ 绑定码无效或已过期，请重新生成。", ct);
            return;
        }

        // 一次性：CAS 标记已用，防止并发抢码。
        var mark = await BindCodes.UpdateOneAsync(
            x => x.Id == bc.Id && x.UsedAt == null,
            Builders<AiChannelBindCode>.Update
                .Set(b => b.UsedAt, now)
                .Set(b => b.UsedByExternalId, msg.ExternalId)
                .Set(b => b.UsedByExternalName, msg.ExternalName),
            cancellationToken: ct);
        if (mark.ModifiedCount == 0)
        {
            await TrySendAsync(ch, Target(msg), "❌ 绑定码已被使用，请重新生成。", ct);
            return;
        }

        await ChannelUsers.InsertOneAsync(new AiChannelUser
        {
            ChannelId = ch.Id,
            ExternalId = msg.ExternalId,
            ExternalName = msg.ExternalName,
            BoundUserId = bc.BoundUserId,
            BoundUserName = bc.BoundUserName,
        }, cancellationToken: ct);
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
            await _ai.RunChatAsync(session, msg.Text,
                BuildSink(ch, msg, session.Id, guest, ct), ct, (JustitiaTier)tier);
        }
        finally
        {
            gate.Release();
        }
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

    // ── 事件出口：ChannelSink（SSE 事件 → IM 消息）────────────────────────

    /// <summary>
    /// 把 RunChatAsync 的 SSE 事件流翻译成 IM 回复：
    /// - 文本增量累积；工具调用/失败以独立段落插入（\n\n 分隔，不粘连）；
    /// - ShowToolCalls=false 时省略工具标记段；
    /// - StreamOutput=true 且频道支持时，增量实时发送/编辑（否则 done 一次性输出）；
    /// - 审批转通知（控制台/IM 按钮决策后同流续跑），done 收尾。
    /// </summary>
    private Func<string, Task> BuildSink(AiChannel ch, ChannelInboundMessage msg, string sessionId, bool guest, CancellationToken ct)
    {
        var sb = new StringBuilder();
        var showToolCalls = ch.ShowToolCalls;
        // 流式输出状态（仅 StreamOutput 且适配器支持时启用）。
        var stream = ch.StreamOutput;
        long streamMessageId = 0;
        var streamLock = new object();
        var lastFlush = DateTime.MinValue;
        // Telegram 编辑限流：增量合并到 ≥600ms 一次才真正编辑。
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
                    // 首条：发送。超长（Telegram 4096 上限）按块发新消息，放弃编辑。
                    if (text.Length > ChunkSize)
                    {
                        await TrySendAsync(ch, Target(msg), text, ct);
                        lock (streamLock) sb.Clear();
                        return;
                    }
                    streamMessageId = await AdapterFor(ch.ChannelType).StartStreamAsync(ch, Target(msg), text, ct);
                    if (streamMessageId == 0)
                    {
                        // 频道不支持流式：回退一次性（done 时统一发送），清空缓冲防重复。
                        lock (streamLock) sb.Clear();
                    }
                }
                else
                {
                    if (text.Length > ChunkSize)
                    {
                        // 超出单条编辑上限：发新消息段，重置编辑目标。
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
                // 编辑失败（消息被删/限流）：降级为一次性输出。
                streamMessageId = 0;
            }
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
                    break; // IM 不展示思维链
                case "tool_call":
                {
                    if (!showToolCalls) break;
                    var toolName = evt["toolCall"]?["toolName"]?.GetValue<string>() ?? "";
                    // 独立段落：标记与前后内容之间空行分隔，避免粘连。
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
                    // 流式模式下审批挂起：先收尾当前流（发掉已生成内容），审批卡独立消息。
                    if (stream) await FlushStreamAsync(force: true);
                    var toolName = evt["toolCall"]?["toolName"]?.GetValue<string>() ?? "";
                    var callId = evt["toolCall"]?["id"]?.GetValue<string>() ?? "";
                    var args = evt["toolCall"]?["argsText"]?.GetValue<string>() ?? "";
                    // 美化：工具名 execute_shell → Execute Shell；参数剔除 agentId、键名美化。
                    var toolPretty = PrettyName(toolName);
                    var (argsHtml, argsPlain) = FormatApprovalArgs(args);
                    var approvalHtml = $"⏳ <b>审批请求</b>：\n工具：<b>{HtmlEncode(toolPretty)}</b>{argsHtml}";
                    var approvalPlain = $"⏳ 审批请求：\n工具：{toolPretty}{argsPlain}";
                    if (guest || callId.Length == 0)
                    {
                        // 访客/异常：纯文本（无按钮），并附命令指引。
                        var guide = "\n\n回复 /approve 批准（或 /approve 5min 临时许可 5 分钟），/reject 拒绝。";
                        await TrySendRichAsync(ch, Target(msg), approvalHtml + guide, approvalPlain + guide, ct);
                    }
                    else
                    {
                        // 已绑定用户：内联按钮（Telegram 原生键盘；其余频道回退纯文本）。
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
                        // 访客会话控制台无人可审批：3 秒后自动拒绝，让 AI 继续回话。
                        var cid = callId;
                        var sid = sessionId;
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                await Task.Delay(3000, ct);
                                await _ai.ResolveApprovalAsync(sid, cid, false, ct);
                                // 自动拒绝后同样清理审批消息（访客为纯文本消息，通常无记录，no-op）。
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
                        // 流式：最终文本已在编辑的消息里，强制 flush 一次收尾。
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
                    {
                        await TrySendAsync(ch, Target(msg),
                            partial.Length > 0 ? $"{partial}\n\n❌ {err}" : $"❌ {err}", ct);
                    }
                    else
                    {
                        var reply = partial.Length > 0 ? $"{partial}\n\n❌ {err}" : $"❌ {err}";
                        await TrySendAsync(ch, Target(msg), reply, ct);
                    }
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

    /// <summary>发送审批请求：Telegram 带 HTML 富文本 + 内联按钮，其余频道回退纯文本。</summary>
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

    /// <summary>向频道用户发送媒体（供 MCP 工具 send_channel_media 调用）。</summary>
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

    /// <summary>审批按钮回调（Telegram 内联键盘）：写入门闩，原运行经 Sink 续跑回推 IM。</summary>
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
        if (text.Length <= ChunkSize)
        {
            await adapter.SendTextAsync(ch, externalId, text, ct);
            return;
        }
        var buf = new StringBuilder();
        foreach (var line in text.Split('\n'))
        {
            if (buf.Length + line.Length + 1 > ChunkSize && buf.Length > 0)
            {
                await adapter.SendTextAsync(ch, externalId, buf.ToString().TrimEnd(), ct);
                buf.Clear();
            }
            buf.AppendLine(line);
        }
        if (buf.Length > 0)
            await adapter.SendTextAsync(ch, externalId, buf.ToString().TrimEnd(), ct);
    }

    /// <summary>控制台 WebSocket 广播（频道事件：审批挂起等）。</summary>
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

    // ── 文案（HTML 富文本 + 纯文本双版本；Telegram 用 HTML，其余回退纯文本）────

    /// <summary>HTML 转义（所有用户输入/工具输出进富文本前必须经过）。</summary>
    private static string HtmlEncode(string s) =>
        System.Net.WebUtility.HtmlEncode(s);

    /// <summary>snake_case → 空格分隔 + 单词首字母大写：execute_shell → Execute Shell。</summary>
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

    /// <summary>富文本发送：频道支持 HTML 时渲染 html，否则发 plain。</summary>
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
        // Telegram：菜单指令（/model /tier），按钮审批，无需文本审批命令。
        // 其他频道：保留文本审批命令（无按钮审批），菜单指令不支持。
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
    /// 审批请求参数美化：解析 JSON，剔除 agentId，其余键名美化（command → Command），
    /// 值做 HTML 转义。返回 (html 行, plain 行) 或空。
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
