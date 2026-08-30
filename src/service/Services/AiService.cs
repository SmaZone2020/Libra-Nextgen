using System.Collections.Concurrent;
using System.ComponentModel;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LibraNextgen.Common.Authorization;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Mcp;
using ModelContextProtocol.Server;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

/// <summary>AI 供应商与 MCP 工具的注册表（供 AiService 与控制器共享）。</summary>
public sealed record AiToolDescriptor(string Name, string Description, JsonObject? Schema);

/// <summary>AI 聊天运行状态（内存态，按会话单并发）。</summary>
public sealed class AiRunState
{
    public required string SessionId { get; init; }
    public required string ProviderId { get; init; }
    public required string Model { get; init; }
    public required string UserId { get; init; }
    /// <summary>操作员显示名（审计用）。</summary>
    public string UserName { get; set; } = "";
    /// <summary>本次运行携带的 Justitia 档位（浏览器持久化 → SSE 请求参数）。</summary>
    public JustitiaTier JustitiaTier { get; set; } = JustitiaTier.Cognitio;
    /// <summary>审批授予的临时提升档位（5/20 分钟许可窗口），到期自动回落。</summary>
    public int? BoostTier { get; set; }
    /// <summary>临时提升到期时间（UTC）。</summary>
    public DateTime? BoostExpiresAt { get; set; }
    /// <summary>有效档位 = 未过期的临时提升档位，否则当前档位。</summary>
    public JustitiaTier EffectiveTier =>
        BoostTier is { } b && BoostExpiresAt is { } exp && exp > DateTime.UtcNow
            ? (JustitiaTier)b
            : JustitiaTier;
    public List<JsonObject> LlmMessages { get; } = new();
    public List<AiToolCall> ToolCalls { get; } = new();
    public List<AiReasoningStep> Reasoning { get; } = new();
    public JsonObject? PendingToolCall { get; set; }
    /// <summary>跨轮累计的助手文本（流式发出并最终落库）。</summary>
    public string AssistantText { get; set; } = "";
    /// <summary>当前轮内累计的文本（用于 LLM 消息组装）。</summary>
    public string TurnText { get; set; } = "";
    public bool Finished { get; set; }
    public CancellationTokenSource? Cts { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    /// <summary>频道会话的上下文（审批续跑时 AsyncLocal 不流动，工具调用前从此恢复注入）。</summary>
    public AiRunContextState? ChannelContext { get; set; }

    /// <summary>向当前 SSE 连接推送事件（approval 挂起后前端仍保持同一连接）。</summary>
    public Func<string, Task>? Notify { get; set; }
    public Task NotifyAsync(string payload) => Notify?.Invoke(payload) ?? Task.CompletedTask;
}

public class AiService
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly MongoDbContext _db;
    private readonly IServiceProvider _services;
    private readonly ILogger<AiService> _logger;
    private readonly AiPromptFileLoader _promptLoader;
    private readonly AuditService _audit;
    private readonly IHttpContextAccessor _http;
    private readonly ConcurrentDictionary<string, AiRunState> _runs = new();
    /// <summary>审批决策门闩：callId → 等待中的 TaskCompletionSource（普通 MCP 等待语义）。</summary>
    private readonly ConcurrentDictionary<string, TaskCompletionSource<string>> _approvalGates = new();

    private static readonly Dictionary<string, string> DefaultBaseUrls = new(StringComparer.OrdinalIgnoreCase)
    {
        ["openai-chat"] = "https://api.openai.com/v1",
        ["openai-response"] = "https://api.openai.com/v1",
        ["anthropic"] = "https://api.anthropic.com/v1",
        ["openai-compatible"] = "",
    };

    public AiService(
        MongoDbContext db,
        IServiceProvider services,
        ILogger<AiService> logger,
        AiPromptFileLoader promptLoader,
        AuditService audit,
        IHttpContextAccessor http)
    {
        _db = db;
        _services = services;
        _logger = logger;
        _promptLoader = promptLoader;
        _audit = audit;
        _http = http;
    }

    /// <summary>在请求作用域内解析 Scoped 服务（工具反射注入用；单例下不可直接 GetService）。</summary>
    private T? ResolveScoped<T>() where T : class
    {
        if (_services is IServiceScopeFactory scopeFactory)
        {
            using var scope = scopeFactory.CreateScope();
            return scope.ServiceProvider.GetService(typeof(T)) as T;
        }
        return _services.GetService(typeof(T)) as T;
    }

    /// <summary>按类型解析 DI 服务（单例直接取，Scoped 走作用域工厂）。</summary>
    private object? ResolveScopedFor(Type type)
    {
        if (_services is IServiceScopeFactory scopeFactory)
        {
            using var scope = scopeFactory.CreateScope();
            return scope.ServiceProvider.GetService(type);
        }
        return _services.GetService(type);
    }

    /// <summary>Justitia 四档 → 审计风险等级（档位即风险边界）。</summary>
    private static RiskLevel RiskForTier(JustitiaTier tier) => tier switch
    {
        JustitiaTier.Cognitio => RiskLevel.Safe,      // 审理：只读侦查
        JustitiaTier.Arbitrium => RiskLevel.Normal,   // 裁量：常规可逆
        JustitiaTier.Imperium => RiskLevel.Dangerous, // 治权：高危需批准
        _ => RiskLevel.Malicious,                     // 独裁：全权/恶意
    };

    /// <summary>从工具参数提取目标 agentId（审计用）。</summary>
    private static string? ExtractAgentId(JsonObject args) =>
        args.TryGetPropertyValue("agentId", out var node) && node is JsonValue v && v.TryGetValue<string>(out var id)
            ? id
            : null;

    /// <summary>AI 工具调用审计（档位决定风险等级）。</summary>
    private async Task AuditAiToolAsync(
        AiRunState state, string toolName, JsonObject args,
        string? output = null, bool success = true, string? permit = null)
    {
        try
        {
            var ip = _http.HttpContext?.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var details = new StringBuilder($"tier={state.EffectiveTier}");
            if (!string.IsNullOrEmpty(permit)) details.Append($", permit={permit}");
            if (args.Count > 0) details.Append($", args={args.ToJsonString()}");
            if (output is { Length: > 0 })
            {
                var clipped = output.Length > 300 ? output[..300] : output;
                details.Append($", result={clipped}");
            }
            if (details.Length > 1500) details.Length = 1500;

            await _audit.LogAsync(
                state.UserId,
                state.UserName,
                $"AI {toolName}",
                RiskClassifier.ClassifyMcpTool(toolName),
                ExtractAgentId(args),
                details.ToString(),
                ip,
                RiskForTier(state.EffectiveTier),
                success);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to write AI tool audit for {Tool}", toolName);
        }
    }

    /// <summary>
    /// 组装 Justitia 系统提示词：本地提示词文件全文 + 运行时注入的当前档位上下文。
    /// 文件缺失/为空时返回空（不注入 system prompt）。
    /// </summary>
    private string BuildSystemPrompt(JustitiaTier tier)
    {
        var prompt = _promptLoader.Current?.Trim() ?? "";
        if (prompt.Length == 0) return "";

        var tierName = tier.ToString().ToUpperInvariant();
        var tierLine = tier switch
        {
            JustitiaTier.Arbitrium => "ARBITRIUM — 裁量 · Weigh, then decide.",
            JustitiaTier.Imperium => "IMPERIUM — 治权 · Request, then act.",
            JustitiaTier.Dictatura => "DICTATURA — 独裁 · No need to request (admin-granted, scoped, TTL-bound).",
            _ => "COGNITIO — 审理 · Observe only, do not punish.",
        };

        return $"""
            {prompt}

            ## SESSION CONTEXT (runtime-injected)
            Current effective tier: {tierName} — {tierLine}
            This tier is enforced server-side (JustitiaPolicy): tool calls above it are held for operator approval, never executed.
            """;
    }

    private IMongoCollection<AiProvider> Providers => _db.GetCollection<AiProvider>("ai_providers");
    private IMongoCollection<AiSession> Sessions => _db.GetCollection<AiSession>("ai_sessions");
    private IMongoCollection<AiMcpConfig> McpConfigs => _db.GetCollection<AiMcpConfig>("ai_mcp_config");

    // ── 供应商 ────────────────────────────────────────────────────────────

    public async Task<List<AiProvider>> GetProvidersAsync(CancellationToken ct = default)
    {
        var list = await Providers.Find(FilterDefinition<AiProvider>.Empty)
            .Sort(Builders<AiProvider>.Sort.Descending(p => p.CreatedAt)).ToListAsync(ct);
        foreach (var p in list) p.ApiKeyEnc = "";
        return list;
    }

    public async Task<AiProvider?> GetProviderAsync(string id, bool includeKey, CancellationToken ct = default)
    {
        var p = await Providers.Find(x => x.Id == id).FirstOrDefaultAsync(ct);
        if (p == null) return null;
        p.ApiKeyEnc = includeKey && p.ApiKeyEnc.Length > 0 ? DecryptKey(p.ApiKeyEnc) : "";
        return p;
    }

    public async Task<AiProvider> CreateProviderAsync(AiProvider input, CancellationToken ct = default)
    {
        var p = new AiProvider
        {
            Name = input.Name.Trim(),
            ProviderType = string.IsNullOrWhiteSpace(input.ProviderType) ? "openai-compatible" : input.ProviderType.Trim(),
            BaseUrl = input.BaseUrl?.Trim() ?? "",
            Models = input.Models ?? new List<string>(),
            DefaultModel = input.DefaultModel?.Trim() ?? "",
            Enabled = input.Enabled,
            RequireApproval = input.RequireApproval,
        };
        if (string.IsNullOrWhiteSpace(p.BaseUrl) && DefaultBaseUrls.TryGetValue(p.ProviderType, out var def))
            p.BaseUrl = def;
        if (p.Models.Count == 0 && !string.IsNullOrWhiteSpace(input.DefaultModel))
            p.Models.Add(input.DefaultModel);
        if (string.IsNullOrWhiteSpace(p.DefaultModel))
            p.DefaultModel = p.Models.FirstOrDefault() ?? "";
        if (!string.IsNullOrWhiteSpace(input.ApiKeyEnc))
            p.ApiKeyEnc = EncryptKey(input.ApiKeyEnc);
        await Providers.InsertOneAsync(p, cancellationToken: ct);
        p.ApiKeyEnc = "";
        return p;
    }

    public async Task<bool> UpdateProviderAsync(string id, AiProvider input, CancellationToken ct = default)
    {
        var update = Builders<AiProvider>.Update
            .Set(p => p.Name, input.Name.Trim())
            .Set(p => p.ProviderType, input.ProviderType)
            .Set(p => p.BaseUrl, input.BaseUrl?.Trim() ?? "")
            .Set(p => p.Models, input.Models ?? new List<string>())
            .Set(p => p.DefaultModel, input.DefaultModel?.Trim() ?? "")
            .Set(p => p.Enabled, input.Enabled)
            .Set(p => p.RequireApproval, input.RequireApproval);
        if (!string.IsNullOrWhiteSpace(input.ApiKeyEnc))
            update = update.Set(p => p.ApiKeyEnc, EncryptKey(input.ApiKeyEnc));
        var r = await Providers.UpdateOneAsync(x => x.Id == id, update, cancellationToken: ct);
        return r.ModifiedCount > 0 || r.MatchedCount > 0;
    }

    public async Task<bool> DeleteProviderAsync(string id, CancellationToken ct = default)
    {
        var r = await Providers.DeleteOneAsync(x => x.Id == id, ct);
        return r.DeletedCount > 0;
    }

    /// <summary>验证供应商连通性（拉取 /models）。</summary>
    public async Task<(bool Ok, string? Error, List<string>? Models)> TestProviderAsync(AiProvider input, CancellationToken ct = default)
    {
        try
        {
            using var http = new HttpClient();
            http.Timeout = TimeSpan.FromSeconds(20);
            var baseUrl = input.BaseUrl?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(baseUrl) && DefaultBaseUrls.TryGetValue(input.ProviderType ?? "", out var def))
                baseUrl = def;
            var url = baseUrl.TrimEnd('/') + "/models";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            var key = input.ApiKeyEnc;
            if (!string.IsNullOrWhiteSpace(key))
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
            using var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var errBody = await resp.Content.ReadAsStringAsync(ct);
                var clipped = errBody.Length > 300 ? errBody[..300] : errBody;
                return (false, $"HTTP {(int)resp.StatusCode}: {clipped}", null);
            }
            var body = await resp.Content.ReadAsStringAsync(ct);
            JsonNode? doc;
            try
            {
                doc = JsonNode.Parse(body);
            }
            catch (JsonException)
            {
                // 端点不存在 / 返回非 JSON（如 HTML 404 页）时给出可读错误。
                return (false, $"模型列表响应不是有效 JSON（{url} 可能不支持 /models 路由）", null);
            }
            if (doc is not JsonObject obj || obj["data"] is not JsonArray dataArr)
            {
                return (false, $"响应缺少 data 数组（{url} 可能不支持 /models 路由）", null);
            }
            var models = dataArr
                .Select(m => m?["id"]?.GetValue<string>() ?? "")
                .Where(m => m.Length > 0).ToList();
            return (true, null, models);
        }
        catch (Exception ex)
        {
            return (false, ex.Message, null);
        }
    }

    // ── 会话 ──────────────────────────────────────────────────────────────

    /// <summary>控制台会话列表（ChannelId == null，频道会话不混入）。</summary>
    public async Task<List<AiSession>> GetSessionsAsync(string userId, CancellationToken ct = default)
    {
        return await Sessions.Find(x => x.UserId == userId && x.ChannelId == null)
            .Sort(Builders<AiSession>.Sort.Descending(s => s.UpdatedAt)).ToListAsync(ct);
    }

    /// <summary>频道会话列表（绑定用户自己的 IM 会话，带频道标记）。</summary>
    public async Task<List<AiSession>> GetChannelSessionsAsync(string userId, CancellationToken ct = default)
    {
        return await Sessions.Find(x => x.UserId == userId && x.ChannelId != null)
            .Sort(Builders<AiSession>.Sort.Descending(s => s.UpdatedAt)).ToListAsync(ct);
    }

    /// <summary>
    /// 按 (channelId, externalId) 取或建频道会话（唯一索引防并发重复）。
    /// UserId 写绑定用户，控制台所有权/审批校验原样生效。
    /// </summary>
    public async Task<AiSession> GetOrCreateChannelSessionAsync(
        string channelId, string channelType, string externalId, string externalName,
        string userId, string userName, string providerId, string model, CancellationToken ct = default)
    {
        var existing = await Sessions.Find(x => x.ChannelId == channelId && x.ChannelExternalId == externalId)
            .FirstOrDefaultAsync(ct);
        if (existing != null) return existing;

        var s = new AiSession
        {
            UserId = userId,
            UserName = userName,
            Title = externalName.Length > 0 ? externalName : "频道会话",
            ProviderId = providerId,
            Model = model,
            ChannelId = channelId,
            ChannelType = channelType,
            ChannelExternalId = externalId,
            ChannelExternalName = externalName,
        };
        try
        {
            await Sessions.InsertOneAsync(s, cancellationToken: ct);
        }
        catch (MongoDB.Driver.MongoWriteException) when (existing == null)
        {
            // 并发创建撞唯一索引：回读胜出者。
            return await Sessions.Find(x => x.ChannelId == channelId && x.ChannelExternalId == externalId)
                .FirstOrDefaultAsync(ct) ?? s;
        }
        return s;
    }

    /// <summary>刷新频道会话的外部昵称/审计名。</summary>
    public async Task UpdateChannelSessionIdentityAsync(
        string sessionId, string externalName, string userName, CancellationToken ct = default)
    {
        await Sessions.UpdateOneAsync(
            x => x.Id == sessionId,
            Builders<AiSession>.Update
                .Set(s => s.ChannelExternalName, externalName)
                .Set(s => s.UserName, userName),
            cancellationToken: ct);
    }

    /// <summary>更新会话模型（IM 菜单切换模型用）。</summary>
    public async Task UpdateSessionModelAsync(string sessionId, string model, CancellationToken ct = default)
    {
        await Sessions.UpdateOneAsync(
            x => x.Id == sessionId,
            Builders<AiSession>.Update.Set(s => s.Model, model),
            cancellationToken: ct);
    }

    /// <summary>删除频道下的全部会话（频道删除时清理）。</summary>
    public async Task DeleteChannelSessionsAsync(string channelId, CancellationToken ct = default)
    {
        await Sessions.DeleteManyAsync(x => x.ChannelId == channelId, ct);
    }

    /// <summary>按 (channelId, externalId) 定位频道会话（IM 审批用，身份即外部用户）。</summary>
    public async Task<AiSession?> GetChannelSessionByExternalAsync(
        string channelId, string externalId, CancellationToken ct = default)
    {
        return await Sessions.Find(x => x.ChannelId == channelId && x.ChannelExternalId == externalId)
            .FirstOrDefaultAsync(ct);
    }

    /// <summary>会话是否存在挂起的审批（控制台打开会话时用于恢复审批模态框）。</summary>
    public async Task<JsonObject?> GetPendingApprovalAsync(string sessionId, string userId, CancellationToken ct = default)
    {
        var session = await Sessions.Find(x => x.Id == sessionId && x.UserId == userId).FirstOrDefaultAsync(ct);
        if (session == null) return null;
        var state = GetRun(sessionId);
        if (state?.PendingToolCall == null) return null;
        var tc = state.PendingToolCall;
        return new JsonObject
        {
            ["id"] = tc["toolCallId"]?.DeepClone() ?? "unknown",
            ["toolName"] = tc["toolName"]?.DeepClone() ?? "unknown",
            ["argsText"] = tc["argsText"]?.DeepClone() ?? "{}",
            ["state"] = "requires-action",
            ["kind"] = tc["kind"]?.DeepClone(),
            ["reason"] = tc["reason"]?.DeepClone(),
            ["requiredTier"] = tc["requiredTier"]?.DeepClone(),
            ["currentTier"] = tc["currentTier"]?.DeepClone(),
        };
    }

    public async Task<AiSession?> GetSessionAsync(string id, string userId, CancellationToken ct = default)
    {
        return await Sessions.Find(x => x.Id == id && x.UserId == userId).FirstOrDefaultAsync(ct);
    }

    public async Task<AiSession> CreateSessionAsync(string userId, string userName, string providerId, string model, CancellationToken ct = default)
    {
        var s = new AiSession
        {
            UserId = userId,
            UserName = userName,
            Title = "新对话",
            ProviderId = providerId,
            Model = model,
        };
        await Sessions.InsertOneAsync(s, cancellationToken: ct);
        return s;
    }

    public async Task<bool> DeleteSessionAsync(string id, string userId, CancellationToken ct = default)
    {
        var r = await Sessions.DeleteOneAsync(x => x.Id == id && x.UserId == userId, ct);
        return r.DeletedCount > 0;
    }

    public async Task<bool> RenameSessionAsync(string id, string userId, string title, CancellationToken ct = default)
    {
        var r = await Sessions.UpdateOneAsync(
            x => x.Id == id && x.UserId == userId,
            Builders<AiSession>.Update.Set(s => s.Title, title),
            cancellationToken: ct);
        return r.ModifiedCount > 0 || r.MatchedCount > 0;
    }

    /// <summary>编辑会话中的一条用户消息内容（原地更新，保留消息 ID 与时间戳）。</summary>
    public async Task<bool> EditMessageAsync(
        string sessionId, string userId, string messageId, string content, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(content)) return false;

        var session = await Sessions.Find(x => x.Id == sessionId && x.UserId == userId).FirstOrDefaultAsync(ct);
        if (session == null) return false;

        var msg = session.Messages.FirstOrDefault(m => m.Id == messageId);
        if (msg == null) return false;
        // 仅允许编辑用户消息（AI 消息不可直接改写）。
        if (msg.Role != "user") return false;

        msg.Content = content.Trim();
        session.UpdatedAt = DateTime.UtcNow;
        await SaveSessionAsync(session, ct);
        return true;
    }

    /// <summary>删除会话中的一条消息（用户消息或 AI 消息均可）。</summary>
    public async Task<bool> DeleteMessageAsync(
        string sessionId, string userId, string messageId, CancellationToken ct = default)
    {
        var session = await Sessions.Find(x => x.Id == sessionId && x.UserId == userId).FirstOrDefaultAsync(ct);
        if (session == null) return false;

        var idx = session.Messages.FindIndex(m => m.Id == messageId);
        if (idx < 0) return false;

        session.Messages.RemoveAt(idx);
        session.UpdatedAt = DateTime.UtcNow;
        await SaveSessionAsync(session, ct);
        return true;
    }

    /// <summary>
    /// 截断会话：保留到指定消息（含）为止，删除其后的全部消息。
    /// 用于编辑消息后自动重发、重新生成时清理后续上下文。
    /// </summary>
    public async Task<bool> TruncateMessagesAfterAsync(
        string sessionId, string userId, string messageId, CancellationToken ct = default)
    {
        var session = await Sessions.Find(x => x.Id == sessionId && x.UserId == userId).FirstOrDefaultAsync(ct);
        if (session == null) return false;

        var idx = session.Messages.FindIndex(m => m.Id == messageId);
        if (idx < 0) return false;

        if (idx + 1 < session.Messages.Count)
        {
            session.Messages.RemoveRange(idx + 1, session.Messages.Count - idx - 1);
            session.UpdatedAt = DateTime.UtcNow;
            await SaveSessionAsync(session, ct);
        }
        return true;
    }

    /// <summary>复制会话为分支：深拷贝消息，标题追加 -fork。</summary>
    public async Task<AiSession?> ForkSessionAsync(string id, string userId, string userName, CancellationToken ct = default)
    {
        var src = await Sessions.Find(x => x.Id == id && x.UserId == userId).FirstOrDefaultAsync(ct);
        if (src == null) return null;

        var fork = new AiSession
        {
            UserId = userId,
            UserName = userName,
            Title = $"{src.Title}-fork",
            ProviderId = src.ProviderId,
            Model = src.Model,
            // 深拷贝消息（含 reasoning/toolCalls/sources），避免引用共享。
            Messages = src.Messages.Select(m => new AiMessage
            {
                Id = Guid.NewGuid().ToString("N"),
                Role = m.Role,
                Content = m.Content,
                Reasoning = m.Reasoning?.Select(r => new AiReasoningStep { Label = r.Label, Content = r.Content }).ToList(),
                ToolCalls = m.ToolCalls?.Select(t => new AiToolCall
                {
                    Id = Guid.NewGuid().ToString("N"),
                    ToolName = t.ToolName,
                    ArgsText = t.ArgsText,
                    State = t.State,
                    Output = t.Output,
                    Error = t.Error,
                }).ToList(),
                Sources = m.Sources?.Select(s => new AiSource { Title = s.Title, SourceType = s.SourceType, Url = s.Url, Description = s.Description }).ToList(),
                CreatedAt = m.CreatedAt,
            }).ToList(),
        };
        await Sessions.InsertOneAsync(fork, cancellationToken: ct);
        return fork;
    }

    // ── MCP 工具注册表 ────────────────────────────────────────────────────

    public async Task<AiMcpConfig> GetMcpConfigAsync(CancellationToken ct = default)
    {
        var cfg = await McpConfigs.Find(FilterDefinition<AiMcpConfig>.Empty).FirstOrDefaultAsync(ct);
        return cfg ?? new AiMcpConfig();
    }

    public async Task SetMcpConfigAsync(AiMcpConfig cfg, CancellationToken ct = default)
    {
        var existing = await McpConfigs.Find(FilterDefinition<AiMcpConfig>.Empty).FirstOrDefaultAsync(ct);
        if (existing == null)
        {
            await McpConfigs.InsertOneAsync(cfg, cancellationToken: ct);
        }
        else
        {
            await McpConfigs.UpdateOneAsync(
                Builders<AiMcpConfig>.Filter.Eq(c => c.Id, existing.Id),
                Builders<AiMcpConfig>.Update
                    .Set(c => c.ToolsEnabled, cfg.ToolsEnabled)
                    .Set(c => c.AllowedTools, cfg.AllowedTools ?? new List<string>()),
                cancellationToken: ct);
        }
    }

    /// <summary>
    /// 枚举 MCP 工具并生成 OpenAI 风格 JSON Schema（单一事实来源：McpServerTool 特性）。
    /// 可通过 AiMcpConfig 白名单过滤。
    /// </summary>
    public async Task<List<AiToolDescriptor>> GetToolsAsync(CancellationToken ct = default)
    {
        var cfg = await GetMcpConfigAsync(ct);
        var result = new List<AiToolDescriptor>();
        if (!cfg.ToolsEnabled) return result;
        foreach (var type in typeof(McpService).Assembly.GetTypes())
        {
            if (type.GetCustomAttribute<McpServerToolTypeAttribute>() == null) continue;
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Static))
            {
                var toolAttr = method.GetCustomAttribute<McpServerToolAttribute>();
                if (toolAttr == null) continue;
                var name = method.Name;
                if (cfg.AllowedTools.Count > 0 && !cfg.AllowedTools.Contains(name)) continue;
                var desc = method.GetCustomAttribute<DescriptionAttribute>()?.Description ?? "";
                var schema = BuildToolSchema(method);
                result.Add(new AiToolDescriptor(name, desc, schema));
            }
        }
        return result.OrderBy(t => t.Name).ToList();
    }

    private static JsonObject BuildToolSchema(MethodInfo method)
    {
        var props = new JsonObject();
        var required = new JsonArray();
        foreach (var p in method.GetParameters())
        {
            if (p.ParameterType == typeof(CancellationToken) || IsDiService(p.ParameterType))
                continue;
            var desc = p.GetCustomAttribute<DescriptionAttribute>()?.Description;
            var node = new JsonObject();
            if (!string.IsNullOrWhiteSpace(desc)) node["description"] = desc;
            if (p.HasDefaultValue) node["default"] = JsonValue.Create(p.DefaultValue);
            if (p.ParameterType == typeof(string))
                node["type"] = "string";
            else if (p.ParameterType == typeof(int) || p.ParameterType == typeof(long))
                node["type"] = "integer";
            else if (p.ParameterType == typeof(double) || p.ParameterType == typeof(float))
                node["type"] = "number";
            else if (p.ParameterType == typeof(bool))
                node["type"] = "boolean";
            else if (p.ParameterType.IsArray)
            {
                node["type"] = "array";
                var elem = p.ParameterType.GetElementType()!;
                node["items"] = new JsonObject { ["type"] = elem == typeof(string) ? "string" : "object" };
            }
            else
                node["type"] = "object";
            props[p.Name!] = node;
            if (!p.IsOptional) required.Add(p.Name);
        }
        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = props,
            ["required"] = required,
            ["additionalProperties"] = true,
        };
    }

    private static bool IsDiService(Type t) =>
        // 注：IHttpContextAccessor 是接口（IsClass=false），但确实是 DI 服务——
        // 必须在此识别，否则会被当成 JSON 参数，LLM 传入 "http": {...} 时
        // Deserialize 到接口会抛异常并炸掉整个 SSE 流。
        t == typeof(IHttpContextAccessor) ||
        (t.IsClass && !t.IsPrimitive && t != typeof(string) && t != typeof(Uri) &&
        (t.Namespace?.StartsWith("LibraNextgen") == true || t.Namespace == "Microsoft.AspNetCore.Http"));

    /// <summary>反射调用一个 [McpServerTool] 静态方法。</summary>
    public async Task<string> InvokeToolAsync(string toolName, JsonObject args, CancellationToken ct = default)
    {
        foreach (var type in typeof(McpService).Assembly.GetTypes())
        {
            if (type.GetCustomAttribute<McpServerToolTypeAttribute>() == null) continue;
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Static))
            {
                if (method.GetCustomAttribute<McpServerToolAttribute>() == null) continue;
                if (method.Name != toolName) continue;

                var ps = method.GetParameters();
                var callArgs = new object?[ps.Length];
                try
                {
                    for (var i = 0; i < ps.Length; i++)
                    {
                        var p = ps[i];
                        if (p.ParameterType == typeof(CancellationToken))
                        {
                            callArgs[i] = ct;
                        }
                        else if (IsDiService(p.ParameterType))
                        {
                            // 单例 AiService：请求上下文用注入的单例 _http；
                            // 其余 DI 服务用作用域工厂按需解析（工具可能注入 Scoped 服务）。
                            callArgs[i] = p.ParameterType == typeof(IHttpContextAccessor)
                                ? _http
                                : ResolveScopedFor(p.ParameterType);
                        }
                        else if (args.TryGetPropertyValue(p.Name, out var node))
                        {
                            callArgs[i] = node.Deserialize(p.ParameterType, JsonOpts);
                        }
                        else if (p.IsOptional)
                        {
                            callArgs[i] = p.DefaultValue;
                        }
                        else
                        {
                            return McpUtils.Error($"missing argument '{p.Name}' for tool '{toolName}'");
                        }
                    }
                }
                catch (Exception ex)
                {
                    // 参数构建/反序列化失败（如 LLM 传入多余参数、类型不匹配）：
                    // 转成结构化工具错误，绝不能炸掉 SSE 流。
                    return McpUtils.Error($"invalid arguments for tool '{toolName}': {ex.Message}");
                }

                try
                {
                    var result = method.Invoke(null, callArgs);
                    if (result is Task<string> task)
                        return await task;
                    if (result is string s) return s;
                    if (result is Task t)
                    {
                        await t;
                        var prop = t.GetType().GetProperty("Result");
                        return prop?.GetValue(t)?.ToString() ?? "ok";
                    }
                    return result?.ToString() ?? "ok";
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "AI tool {Tool} failed", toolName);
                    var inner = ex is TargetInvocationException { InnerException: not null } tie ? tie.InnerException! : ex;
                    return McpUtils.Error(inner.Message);
                }
            }
        }
        return McpUtils.Error($"unknown tool '{toolName}'");
    }

    // ── 聊天编排 ──────────────────────────────────────────────────────────

    public AiRunState? GetRun(string sessionId) => _runs.TryGetValue(sessionId, out var r) ? r : null;
    public void RemoveRun(string sessionId) => _runs.TryRemove(sessionId, out _);

    /// <summary>
    /// 启动一次流式聊天。SSE 事件经 onEvent 回调：
    ///   reasoning {label, content} / message {delta} / tool_call {toolCall} /
    ///   tool_result {toolCallId, toolName, output} / approval {toolCall} /
    ///   done {sessionId, messageId} / error {message}
    /// </summary>
    public async Task RunChatAsync(
        AiSession session,
        string content,
        Func<string, Task> onEvent,
        CancellationToken ct = default,
        JustitiaTier justitiaTier = JustitiaTier.Cognitio)
    {
        var provider = await GetProviderAsync(session.ProviderId, includeKey: true, ct);
        if (provider == null)
        {
            await onEvent(JsonSerializer.Serialize(new { type = "error", message = "AI provider not found" }, JsonOpts));
            return;
        }

        // 用户消息先落库。
        var userMsg = new AiMessage { Role = "user", Content = content };
        session.Messages.Add(userMsg);
        await SaveSessionAsync(session, ct);

        var state = new AiRunState
        {
            SessionId = session.Id,
            ProviderId = session.ProviderId,
            Model = session.Model,
            UserId = session.UserId,
            UserName = session.UserName,
            JustitiaTier = justitiaTier,
            // 审批挂起时前端仍保持同一 SSE 连接：把 onEvent 挂到 state 上，
            // ResolveApprovalAsync 无需新建流即可向原连接推送 tool_result。
            Notify = onEvent,
        };
        _runs[session.Id] = state;
        _logger.LogInformation("RunChatAsync started for session {Session} (tier {Tier})", session.Id, justitiaTier);
        state.Cts = CancellationTokenSource.CreateLinkedTokenSource(ct);

        // 频道会话：注入运行上下文（AsyncLocal），供 MCP 工具（send_channel_media 等）
        // 读取"当前对话者"，工具无需用户显式传目标，天然防越权。
        var hadContext = false;
        if (session.ChannelId != null)
        {
            state.ChannelContext = new AiRunContextState
            {
                ChannelId = session.ChannelId,
                ChannelType = session.ChannelType ?? "",
                ExternalId = session.ChannelExternalId ?? "",
            };
            AiRunContext.Set(state.ChannelContext);
            hadContext = true;
        }

        // 历史消息（含刚追加的用户消息）→ OpenAI 格式。
        foreach (var m in session.Messages)
        {
            if (m.Role == "user")
            {
                state.LlmMessages.Add(new JsonObject { ["role"] = "user", ["content"] = m.Content });
            }
            else if (m.Role == "assistant")
            {
                var obj = new JsonObject { ["role"] = "assistant", ["content"] = m.Content };
                if (m.ToolCalls is { Count: > 0 })
                {
                    var arr = new JsonArray();
                    foreach (var tc in m.ToolCalls)
                        arr.Add(new JsonObject { ["id"] = tc.Id, ["type"] = "function", ["function"] = new JsonObject { ["name"] = tc.ToolName, ["arguments"] = tc.ArgsText } });
                    obj["tool_calls"] = arr;
                }
                state.LlmMessages.Add(obj);
            }
            else if (m.Role == "tool" && m.ToolCalls is { Count: > 0 })
            {
                var tc = m.ToolCalls[0];
                state.LlmMessages.Add(new JsonObject
                {
                    ["role"] = "tool",
                    ["tool_call_id"] = tc.Id,
                    ["content"] = tc.State == "error" ? (tc.Error ?? "") : (tc.Output ?? ""),
                });
            }
        }

        try
        {
            await ChatLoopAsync(state, provider, onEvent, state.Cts.Token);
        }
        catch (OperationCanceledException)
        {
            await onEvent(JsonSerializer.Serialize(new { type = "error", message = "stopped" }, JsonOpts));
        }
        finally
        {
            if (hadContext) AiRunContext.Clear();
            state.Finished = true;
            // 挂起审批时保留运行态：ResolveApprovalAsync 需要从 _runs 恢复续跑，
            // 只有真正结束（无待审批调用）才移除，避免 /chat/action 找不到 state 而静默失败。
            if (state.PendingToolCall == null)
            {
                state.Cts.Dispose();
                // 竞态防御：同一 session 可能已被新运行覆盖（RunChatAsync 被再次触发），
                // 只有 _runs 里仍指向当前 state 才移除，避免误删新运行的挂起状态。
                if (_runs.TryGetValue(session.Id, out var current) && ReferenceEquals(current, state))
                    _runs.TryRemove(session.Id, out _);
                _logger.LogWarning("RunChatAsync finally removed run state for session {Session} (no pending tool call)", session.Id);
            }
            else
            {
                _logger.LogWarning("RunChatAsync finally kept run state for session {Session} (pending tool call {Call})",
                    session.Id, state.PendingToolCall["toolCallId"]?.GetValue<string>());
            }
        }
    }

    private async Task ChatLoopAsync(AiRunState state, AiProvider provider, Func<string, Task> onEvent, CancellationToken ct)
    {
        var tools = await GetToolsAsync(ct);
        const int maxTurns = 12;

        for (var turn = 0; turn < maxTurns; turn++)
        {
            state.TurnText = "";
            Dictionary<int, (string Id, string Name, string Args)> toolCallsThisTurn;

            try
            {
                toolCallsThisTurn = provider.ProviderType switch
                {
                    "anthropic" => await ChatTurnAnthropicAsync(state, provider, tools, onEvent, ct),
                    "openai-response" => await ChatTurnOpenAiResponseAsync(state, provider, tools, onEvent, ct),
                    _ => await ChatTurnOpenAiChatAsync(state, provider, tools, onEvent, ct),
                };
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                await onEvent(JsonSerializer.Serialize(new { type = "error", message = $"LLM request failed: {ex.Message}" }, JsonOpts));
                return;
            }

            // 有工具调用 → 逐个执行（或请求审批）。
            if (toolCallsThisTurn.Count > 0)
            {
                var asstMsg = new JsonObject { ["role"] = "assistant", ["content"] = state.TurnText };
                var tcArr2 = new JsonArray();
                foreach (var (id, name, args) in toolCallsThisTurn.Values)
                    tcArr2.Add(new JsonObject { ["id"] = id.Length > 0 ? id : Guid.NewGuid().ToString("N"), ["type"] = "function", ["function"] = new JsonObject { ["name"] = name, ["arguments"] = args.Length == 0 ? "{}" : args } });
                asstMsg["tool_calls"] = tcArr2;
                state.LlmMessages.Add(asstMsg);

                foreach (var (id, name, args) in toolCallsThisTurn.Values)
                {
                    var callId = id.Length > 0 ? id : Guid.NewGuid().ToString("N");
                    var argsText = args.Length == 0 ? "{}" : args;
                    // 记录该工具调用发生时已输出的助手文本，供前端把工具调用穿插在文本流中。
                    var toolCall = new AiToolCall { Id = callId, ToolName = name, ArgsText = argsText, TextBefore = state.AssistantText };
                    state.ToolCalls.Add(toolCall);

                    // request_tier_elevation：正式的权限提升请求（§6 Writ 通道）。
                    // 不执行任何动作，直接把请求转成审批挂起（kind=escalation），
                    // 由 Operator 通过审批模态框批准（一次性/5min/20min 临时提升）或拒绝。
                    if (name == "request_tier_elevation")
                    {
                        var reqArgs = JsonNode.Parse(argsText) as JsonObject ?? new JsonObject();
                        // 兼容 LLM 传参：requiredTier 或 tier 键均可。
                        var requestedTierKey = reqArgs["requiredTier"]?.GetValue<string>()
                            ?? reqArgs["tier"]?.GetValue<string>()
                            ?? "";
                        var requested = JustitiaPolicy.Parse(requestedTierKey);
                        if (requested <= state.EffectiveTier)
                        {
                            // 目标档位不高于当前有效档位：无需提升，直接说明。
                            var note = McpUtils.Ok(new { status = "no-elevation-needed", currentTier = state.EffectiveTier.ToString().ToLowerInvariant(), requested = requestedTierKey });
                            toolCall.State = "output-available";
                            toolCall.Output = note;
                            await onEvent(JsonSerializer.Serialize(new { type = "tool_result", toolCallId = callId, toolName = name, output = note, state = toolCall.State }, JsonOpts));
                            state.LlmMessages.Add(new JsonObject { ["role"] = "tool", ["tool_call_id"] = callId, ["content"] = note });
                            continue;
                        }

                        toolCall.State = "requires-action";
                        state.PendingToolCall = new JsonObject
                        {
                            ["sessionId"] = state.SessionId,
                            ["toolCallId"] = callId,
                            ["toolName"] = name,
                            ["argsText"] = argsText,
                            ["reason"] = $"tier elevation requested: {state.EffectiveTier} → {requested}",
                            ["kind"] = "escalation",
                            ["requiredTier"] = (int)requested,
                            ["currentTier"] = (int)state.EffectiveTier,
                        };
                        await onEvent(JsonSerializer.Serialize(new { type = "approval", toolCall = new { id = callId, toolName = name, argsText, reason = $"tier elevation requested: {state.EffectiveTier} → {requested}", kind = "escalation", requiredTier = (int)requested, currentTier = (int)state.EffectiveTier } }, JsonOpts));
                        // 提权请求本身留痕（风险按请求的目标档位计）。
                        await AuditAiToolAsync(state, name, reqArgs,
                            $"elevation requested: {state.EffectiveTier} → {requested}", success: false);
                        // 挂起等待 Operator 决策：把控制权交给内部等待循环。
                        // 工具调用始终保留在 LlmMessages（assistant tool_calls 已预置），
                        // 批准/拒绝后由 ResolveApprovalAsync 以普通 MCP 工具结果的方式恢复。
                        await WaitForApprovalAsync(state, name, callId, ct);
                        continue; // 继续处理本轮的其余/后续工具调用。
                    }

                    // Justitia 档位门槛：有效档位（含审批临时提升）不足 → 挂起等审批。
                    // 档位内工具直接执行，不再逐调用弹审批。
                    var required = JustitiaPolicy.RequiredTier(name);
                    if (state.EffectiveTier < required)
                    {
                        toolCall.State = "requires-action";
                        state.PendingToolCall = new JsonObject
                        {
                            ["sessionId"] = state.SessionId,
                            ["toolCallId"] = callId,
                            ["toolName"] = name,
                            ["argsText"] = argsText,
                            ["reason"] = $"tool requires tier {required} (current {state.EffectiveTier})",
                            ["kind"] = "escalation",
                            ["requiredTier"] = (int)required,
                            ["currentTier"] = (int)state.EffectiveTier,
                        };
                        await onEvent(JsonSerializer.Serialize(new { type = "approval", toolCall = new { id = callId, toolName = name, argsText, reason = $"tool requires tier {required} (current {state.EffectiveTier})", kind = "escalation", requiredTier = (int)required, currentTier = (int)state.EffectiveTier } }, JsonOpts));
                        // 超档工具请求本身留痕（风险按所需档位计）。
                        await AuditAiToolAsync(state, name,
                            JsonNode.Parse(argsText) as JsonObject ?? new JsonObject(),
                            $"approval requested: needs tier {required} (current {state.EffectiveTier})", success: false);
                        // 挂起等待 Operator 决策（同 request_tier_elevation）。
                        await WaitForApprovalAsync(state, name, callId, ct);
                        continue;
                    }

                    await onEvent(JsonSerializer.Serialize(new { type = "tool_call", toolCall = new { id = callId, toolName = name, argsText, state = "running" } }, JsonOpts));
                    string output;
                    try
                    {
                        output = await InvokeToolAsync(name, JsonNode.Parse(argsText) as JsonObject ?? new JsonObject(), ct);
                    }
                    catch (Exception ex)
                    {
                        // 兜底：任何工具执行异常都转成结构化错误，绝不炸掉 SSE 流。
                        _logger.LogWarning(ex, "AI tool {Tool} threw unhandled exception", name);
                        output = McpUtils.Error($"tool '{name}' failed: {ex.Message}");
                    }
                    var isError = output.Contains("\"error\"", StringComparison.Ordinal);
                    toolCall.State = isError ? "error" : "output-available";
                    toolCall.Output = output;
                    if (isError) toolCall.Error = output;
                    // AI 工具调用审计：风险等级由当前档位决定。
                    await AuditAiToolAsync(state, name, JsonNode.Parse(argsText) as JsonObject ?? new JsonObject(), output, !isError);
                    await onEvent(JsonSerializer.Serialize(new { type = "tool_result", toolCallId = callId, toolName = name, output, state = toolCall.State }, JsonOpts));
                    state.LlmMessages.Add(new JsonObject
                    {
                        ["role"] = "tool",
                        ["tool_call_id"] = callId,
                        ["content"] = output,
                    });
                }
                continue; // 进入下一轮。
            }

            break; // 无工具调用 → 结束。
        }

        // 落库 & 结束事件。
        var finalMsg = new AiMessage
        {
            Role = "assistant",
            Content = state.AssistantText,
            Reasoning = state.Reasoning.Count > 0 ? MergeReasoningSteps(state.Reasoning) : null,
            ToolCalls = state.ToolCalls.Count > 0 ? state.ToolCalls : null,
        };
        var session = await GetSessionAsync(state.SessionId, state.UserId, ct);
        if (session != null)
        {
            session.Messages.Add(finalMsg);
            if (session.Title == "新对话")
            {
                var firstUser = state.LlmMessages.FirstOrDefault(m => m["role"]?.GetValue<string>() == "user");
                var text = firstUser?["content"]?.GetValue<string>() ?? "";
                if (text.Length > 24) text = text[..24] + "…";
                session.Title = text.Length > 0 ? text : "新对话";
            }
            await SaveSessionAsync(session, ct);
        }
        await onEvent(JsonSerializer.Serialize(new { type = "done", sessionId = state.SessionId, messageId = finalMsg.Id }, JsonOpts));
    }

    // ── 协议适配：消息历史转换 ────────────────────────────────────────────────

    private static JsonArray BuildOpenAiChatMessages(List<JsonObject> llmMessages) =>
        new(llmMessages.Select(m => (JsonNode)m.DeepClone()).ToArray());

    private static JsonArray BuildOpenAiResponseInput(List<JsonObject> llmMessages)
    {
        var input = new JsonArray();
        foreach (var m in llmMessages)
        {
            var role = m["role"]?.GetValue<string>() ?? "user";
            if (role == "tool")
            {
                input.Add(new JsonObject
                {
                    ["type"] = "function_call_output",
                    ["call_id"] = m["tool_call_id"]?.GetValue<string>() ?? Guid.NewGuid().ToString("N"),
                    ["output"] = m["content"]?.GetValue<string>() ?? "",
                });
                continue;
            }
            var obj = new JsonObject { ["role"] = role, ["content"] = m["content"]?.GetValue<string>() ?? "" };
            if (role == "assistant" && m["tool_calls"] is JsonArray tcArr)
            {
                var items = new List<JsonNode> { obj };
                foreach (var tc in tcArr.OfType<JsonObject>())
                {
                    var fn = tc["function"] as JsonObject;
                    items.Add(new JsonObject
                    {
                        ["type"] = "function_call",
                        ["call_id"] = tc["id"]?.GetValue<string>() ?? Guid.NewGuid().ToString("N"),
                        ["name"] = fn?["name"]?.GetValue<string>() ?? "",
                        ["arguments"] = fn?["arguments"]?.GetValue<string>() ?? "{}",
                    });
                }
                foreach (var item in items) input.Add(item);
            }
            else
            {
                input.Add(obj);
            }
        }
        return input;
    }

    private static JsonArray BuildAnthropicMessages(List<JsonObject> llmMessages)
    {
        var result = new List<JsonObject>();
        foreach (var m in llmMessages)
        {
            var role = m["role"]?.GetValue<string>() ?? "user";
            JsonArray content;
            if (role == "tool")
            {
                content = new JsonArray
                {
                    new JsonObject
                    {
                        ["type"] = "tool_result",
                        ["tool_use_id"] = m["tool_call_id"]?.GetValue<string>() ?? Guid.NewGuid().ToString("N"),
                        ["content"] = m["content"]?.GetValue<string>() ?? "",
                    },
                };
                role = "user";
            }
            else
            {
                content = new JsonArray { new JsonObject { ["type"] = "text", ["text"] = m["content"]?.GetValue<string>() ?? "" } };
                if (role == "assistant" && m["tool_calls"] is JsonArray tcArr)
                {
                    foreach (var tc in tcArr.OfType<JsonObject>())
                    {
                        var fn = tc["function"] as JsonObject;
                        content.Add(new JsonObject
                        {
                            ["type"] = "tool_use",
                            ["id"] = tc["id"]?.GetValue<string>() ?? Guid.NewGuid().ToString("N"),
                            ["name"] = fn?["name"]?.GetValue<string>() ?? "",
                            ["input"] = JsonNode.Parse(fn?["arguments"]?.GetValue<string>() ?? "{}") ?? new JsonObject(),
                        });
                    }
                }
            }

            // Claude 要求 user/assistant 交替：合并连续 user 消息。
            if (role == "user" && result.Count > 0 && result[^1]["role"]?.GetValue<string>() == "user")
            {
                var prevContent = result[^1]["content"] as JsonArray;
                foreach (var c in content) prevContent?.Add(c);
                continue;
            }
            result.Add(new JsonObject { ["role"] = role, ["content"] = content });
        }
        return new JsonArray(result.ToArray());
    }

    private static void AddOpenAiTools(JsonObject body, List<AiToolDescriptor> tools)
    {
        if (tools.Count == 0) return;
        var toolArr = new JsonArray();
        foreach (var t in tools)
            toolArr.Add(new JsonObject { ["type"] = "function", ["function"] = new JsonObject { ["name"] = t.Name, ["description"] = t.Description, ["parameters"] = t.Schema?.DeepClone() ?? new JsonObject() } });
        body["tools"] = toolArr;
        body["tool_choice"] = "auto";
    }

    // ── 协议适配：[OI] Chat（chat/completions，默认）────────────────────────

    private async Task<Dictionary<int, (string Id, string Name, string Args)>> ChatTurnOpenAiChatAsync(
        AiRunState state, AiProvider provider, List<AiToolDescriptor> tools, Func<string, Task> onEvent, CancellationToken ct)
    {
        var messages = BuildOpenAiChatMessages(state.LlmMessages);
        var systemPrompt = BuildSystemPrompt(state.EffectiveTier);
        if (systemPrompt.Length > 0)
            messages.Insert(0, new JsonObject { ["role"] = "system", ["content"] = systemPrompt });

        var body = new JsonObject
        {
            ["model"] = state.Model,
            ["messages"] = messages,
            ["stream"] = true,
        };
        AddOpenAiTools(body, tools);

        using var http = new HttpClient();
        http.Timeout = TimeSpan.FromMinutes(5);
        using var req = new HttpRequestMessage(HttpMethod.Post, provider.BaseUrl.TrimEnd('/') + "/chat/completions");
        req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        if (!string.IsNullOrWhiteSpace(provider.ApiKeyEnc))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", provider.ApiKeyEnc);

        using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var errBody = await resp.Content.ReadAsStringAsync(ct);
            await onEvent(JsonSerializer.Serialize(new { type = "error", message = $"LLM HTTP {(int)resp.StatusCode}: {errBody}" }, JsonOpts));
            return new Dictionary<int, (string, string, string)>();
        }

        var toolCalls = new Dictionary<int, (string Id, string Name, string Args)>();
        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line == null) break;
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var data = line["data:".Length..].Trim();
            if (data == "[DONE]") break;
            JsonNode? chunk;
            try { chunk = JsonNode.Parse(data); } catch { continue; }
            if (chunk is not JsonObject obj) continue;

            var choices = obj["choices"]?.AsArray();
            if (choices == null || choices.Count == 0) continue;
            var choice = choices[0] as JsonObject;
            var delta = choice?["delta"] as JsonObject;

            if (delta?["reasoning_content"] is JsonValue rv)
            {
                var text = rv.GetValue<string>();
                if (text.Length > 0)
                {
                    state.Reasoning.Add(new AiReasoningStep { Label = "推理", Content = text });
                    await onEvent(JsonSerializer.Serialize(new { type = "reasoning", label = "推理", content = text }, JsonOpts));
                }
            }

            if (delta?["content"] is JsonValue cv)
            {
                var text = cv.GetValue<string>();
                state.AssistantText += text;
                state.TurnText += text;
                await onEvent(JsonSerializer.Serialize(new { type = "message", delta = text }, JsonOpts));
            }

            if (delta?["tool_calls"] is JsonArray tcArr)
            {
                foreach (var tcNode in tcArr)
                {
                    if (tcNode is not JsonObject tc) continue;
                    var idx = tc["index"]?.GetValue<int>() ?? 0;
                    var fn = tc["function"] as JsonObject;
                    if (fn == null) continue;
                    var id = tc["id"]?.GetValue<string>() ?? "";
                    var name = fn["name"]?.GetValue<string>() ?? "";
                    var args = fn["arguments"]?.GetValue<string>() ?? "";
                    if (toolCalls.TryGetValue(idx, out var existing))
                        toolCalls[idx] = (existing.Id.Length > 0 ? existing.Id : id, existing.Name.Length > 0 ? existing.Name : name, existing.Args + args);
                    else
                        toolCalls[idx] = (id, name, args);
                }
            }

            if (choice?["finish_reason"]?.GetValue<string>() is { Length: > 0 } fr &&
                fr is "tool_calls" or "stop" or "length")
                break;
        }
        return toolCalls;
    }

    // ── 协议适配：[OI] Response（/responses）───────────────────────────────

    private async Task<Dictionary<int, (string Id, string Name, string Args)>> ChatTurnOpenAiResponseAsync(
        AiRunState state, AiProvider provider, List<AiToolDescriptor> tools, Func<string, Task> onEvent, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["model"] = state.Model,
            ["input"] = BuildOpenAiResponseInput(state.LlmMessages),
            ["stream"] = true,
            ["store"] = false,
        };
        var systemPrompt = BuildSystemPrompt(state.EffectiveTier);
        if (systemPrompt.Length > 0) body["instructions"] = systemPrompt;
        if (tools.Count > 0)
        {
            var toolArr = new JsonArray();
            foreach (var t in tools)
                toolArr.Add(new JsonObject { ["type"] = "function", ["name"] = t.Name, ["description"] = t.Description, ["parameters"] = t.Schema?.DeepClone() ?? new JsonObject() });
            body["tools"] = toolArr;
        }

        using var http = new HttpClient();
        http.Timeout = TimeSpan.FromMinutes(5);
        using var req = new HttpRequestMessage(HttpMethod.Post, provider.BaseUrl.TrimEnd('/') + "/responses");
        req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        if (!string.IsNullOrWhiteSpace(provider.ApiKeyEnc))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", provider.ApiKeyEnc);

        using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var errBody = await resp.Content.ReadAsStringAsync(ct);
            await onEvent(JsonSerializer.Serialize(new { type = "error", message = $"LLM HTTP {(int)resp.StatusCode}: {errBody}" }, JsonOpts));
            return new Dictionary<int, (string, string, string)>();
        }

        var toolCalls = new Dictionary<int, (string Id, string Name, string Args)>();
        var idxByCallId = new Dictionary<string, int>();
        var nextIndex = 0;
        var done = false;
        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line == null) break;
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var data = line["data:".Length..].Trim();
            if (data == "[DONE]") break;
            JsonNode? chunk;
            try { chunk = JsonNode.Parse(data); } catch { continue; }
            if (chunk is not JsonObject obj) continue;

            var type = obj["type"]?.GetValue<string>() ?? "";
            switch (type)
            {
                case "response.output_item.added":
                {
                    var item = obj["item"] as JsonObject;
                    if (item?["type"]?.GetValue<string>() == "function_call")
                    {
                        var callId = item["id"]?.GetValue<string>() ?? Guid.NewGuid().ToString("N");
                        var name = item["name"]?.GetValue<string>() ?? "";
                        idxByCallId[callId] = nextIndex;
                        toolCalls[nextIndex++] = (callId, name, "");
                    }
                    break;
                }
                case "response.function_call_arguments.delta":
                {
                    var cid = obj["item_id"]?.GetValue<string>() ?? "";
                    var part = obj["delta"]?.GetValue<string>() ?? "";
                    if (idxByCallId.TryGetValue(cid, out var idx) && toolCalls.TryGetValue(idx, out var ex))
                        toolCalls[idx] = (ex.Id, ex.Name, ex.Args + part);
                    break;
                }
                case "response.output_text.delta":
                {
                    var text = obj["delta"]?.GetValue<string>() ?? "";
                    state.AssistantText += text;
                    state.TurnText += text;
                    await onEvent(JsonSerializer.Serialize(new { type = "message", delta = text }, JsonOpts));
                    break;
                }
                case "response.reasoning_summary_text.delta":
                case "response.reasoning_text.delta":
                {
                    var text = obj["delta"]?.GetValue<string>() ?? "";
                    if (text.Length > 0)
                    {
                        state.Reasoning.Add(new AiReasoningStep { Label = "推理", Content = text });
                        await onEvent(JsonSerializer.Serialize(new { type = "reasoning", label = "推理", content = text }, JsonOpts));
                    }
                    break;
                }
                case "response.completed":
                case "response.failed":
                case "response.incomplete":
                    done = true;
                    break;
            }
            if (done) break;
        }
        return toolCalls;
    }

    // ── 协议适配：Claude（/v1/messages）────────────────────────────────────

    private async Task<Dictionary<int, (string Id, string Name, string Args)>> ChatTurnAnthropicAsync(
        AiRunState state, AiProvider provider, List<AiToolDescriptor> tools, Func<string, Task> onEvent, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["model"] = state.Model,
            ["max_tokens"] = 8192,
            ["messages"] = BuildAnthropicMessages(state.LlmMessages),
            ["stream"] = true,
        };
        var systemPrompt = BuildSystemPrompt(state.EffectiveTier);
        if (systemPrompt.Length > 0) body["system"] = systemPrompt;
        if (tools.Count > 0)
        {
            var toolArr = new JsonArray();
            foreach (var t in tools)
                toolArr.Add(new JsonObject { ["name"] = t.Name, ["description"] = t.Description, ["input_schema"] = t.Schema?.DeepClone() ?? new JsonObject() });
            body["tools"] = toolArr;
        }

        using var http = new HttpClient();
        http.Timeout = TimeSpan.FromMinutes(5);
        using var req = new HttpRequestMessage(HttpMethod.Post, provider.BaseUrl.TrimEnd('/') + "/messages");
        req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        if (!string.IsNullOrWhiteSpace(provider.ApiKeyEnc))
        {
            req.Headers.TryAddWithoutValidation("x-api-key", provider.ApiKeyEnc);
            req.Headers.TryAddWithoutValidation("anthropic-version", "2023-06-01");
        }

        using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var errBody = await resp.Content.ReadAsStringAsync(ct);
            await onEvent(JsonSerializer.Serialize(new { type = "error", message = $"LLM HTTP {(int)resp.StatusCode}: {errBody}" }, JsonOpts));
            return new Dictionary<int, (string, string, string)>();
        }

        var toolCalls = new Dictionary<int, (string Id, string Name, string Args)>();
        var done = false;
        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line == null) break;
            if (!line.StartsWith("event:", StringComparison.Ordinal) && !line.StartsWith("data:", StringComparison.Ordinal)) continue;
            if (line.StartsWith("event:", StringComparison.Ordinal)) continue; // 事件类型行仅作提示，实际字段在 data 中。
            var data = line["data:".Length..].Trim();
            if (data == "[DONE]") break;
            JsonNode? chunk;
            try { chunk = JsonNode.Parse(data); } catch { continue; }
            if (chunk is not JsonObject obj) continue;

            var type = obj["type"]?.GetValue<string>() ?? "";
            switch (type)
            {
                case "content_block_start":
                {
                    var idx = obj["index"]?.GetValue<int>() ?? 0;
                    var block = obj["content_block"] as JsonObject;
                    var btype = block?["type"]?.GetValue<string>() ?? "";
                    if (btype == "tool_use")
                    {
                        var callId = block?["id"]?.GetValue<string>() ?? Guid.NewGuid().ToString("N");
                        var name = block?["name"]?.GetValue<string>() ?? "";
                        toolCalls[idx] = (callId, name, "");
                    }
                    break;
                }
                case "content_block_delta":
                {
                    var idx = obj["index"]?.GetValue<int>() ?? 0;
                    var delta = obj["delta"] as JsonObject;
                    var dtype = delta?["type"]?.GetValue<string>() ?? "";
                    if (dtype == "text_delta")
                    {
                        var text = delta?["text"]?.GetValue<string>() ?? "";
                        state.AssistantText += text;
                        state.TurnText += text;
                        await onEvent(JsonSerializer.Serialize(new { type = "message", delta = text }, JsonOpts));
                    }
                    else if (dtype == "input_json_delta")
                    {
                        var part = delta?["partial_json"]?.GetValue<string>() ?? "";
                        if (toolCalls.TryGetValue(idx, out var ex))
                            toolCalls[idx] = (ex.Id, ex.Name, ex.Args + part);
                    }
                    else if (dtype == "thinking_delta")
                    {
                        var text = delta?["thinking"]?.GetValue<string>() ?? "";
                        if (text.Length > 0)
                        {
                            state.Reasoning.Add(new AiReasoningStep { Label = "推理", Content = text });
                            await onEvent(JsonSerializer.Serialize(new { type = "reasoning", label = "推理", content = text }, JsonOpts));
                        }
                    }
                    break;
                }
                case "message_delta":
                {
                    var stopReason = obj["delta"]?["stop_reason"]?.GetValue<string>() ?? "";
                    if (stopReason is "tool_use" or "end_turn" or "max_tokens" or "stop_sequence") done = true;
                    break;
                }
                case "message_stop":
                    done = true;
                    break;
                case "error":
                {
                    var msg = obj["error"]?.ToJsonString() ?? "unknown anthropic error";
                    await onEvent(JsonSerializer.Serialize(new { type = "error", message = msg }, JsonOpts));
                    done = true;
                    break;
                }
            }
            if (done) break;
        }
        return toolCalls;
    }

    /// <summary>
    /// 挂起等待 Operator 对当前工具调用的决策（无限时）。
    /// RunChatAsync 的 SSE 保持打开（心跳保活由 Kestrel 处理），前端收到
    /// approval 事件后弹模态框；用户批准/拒绝时通过 /chat/action 调用
    /// ResolveApprovalAsync 完成工具执行并写入 tool 结果，本循环随即继续。
    /// </summary>
    private async Task WaitForApprovalAsync(AiRunState state, string toolName, string callId, CancellationToken ct)
    {
        var gate = _approvalGates.GetOrAdd(callId, _ => new TaskCompletionSource<string>(
            TaskCreationOptions.RunContinuationsAsynchronously));
        _logger.LogInformation("WaitForApproval: waiting for call {Call} (session {Session}, pending={Pending})",
            callId, state.SessionId, state.PendingToolCall?["toolCallId"]?.GetValue<string>());

        try
        {
            // 无限等待；仅取消/会话切换时退出（SSE 断开由控制器层处理）。
            var output = await gate.Task.WaitAsync(ct);
            _logger.LogInformation("WaitForApproval: gate resolved for call {Call} (session {Session})", callId, state.SessionId);
            var pending = state.ToolCalls.FirstOrDefault(t => t.Id == callId);
            if (pending == null) return;

            var isError = output.Contains("\"error\"", StringComparison.Ordinal);
            pending.State = isError ? "error" : "output-available";
            pending.Output = output;
            if (isError) pending.Error = output;
            await EmitToolResultAsync(state, callId, pending.ToolName, output, pending.State);
            state.LlmMessages.Add(new JsonObject { ["role"] = "tool", ["tool_call_id"] = callId, ["content"] = output });
        }
        catch (OperationCanceledException)
        {
            // 运行被取消：工具保持挂起状态，不执行。
            var pending = state.ToolCalls.FirstOrDefault(t => t.Id == callId);
            if (pending != null) pending.State = "requires-action";
            _logger.LogWarning("WaitForApproval: gate wait cancelled for call {Call} (session {Session})", callId, state.SessionId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "WaitForApproval: gate wait failed for call {Call} (session {Session})", callId, state.SessionId);
        }
        finally
        {
            _approvalGates.TryRemove(callId, out _);
        }
    }

    /// <summary>统一发送 tool_result SSE 事件。</summary>
    private static async Task EmitToolResultAsync(
        AiRunState state, string callId, string toolName, string output, string toolState)
        => await state.NotifyAsync(JsonSerializer.Serialize(new { type = "tool_result", toolCallId = callId, toolName, output, state = toolState }, JsonOpts));

    /// <summary>
    /// 合并推理步骤：LLM 推理增量是按词推送的（每词一个 step），落库前把
    /// 连续同 label 的步骤拼接成单个 step，避免前端显示成逐词"推理"块。
    /// </summary>
    private static List<AiReasoningStep> MergeReasoningSteps(List<AiReasoningStep> steps)
    {
        var result = new List<AiReasoningStep>();
        foreach (var step in steps)
        {
            if (result.Count > 0 && result[^1].Label == step.Label)
            {
                result[^1] = new AiReasoningStep
                {
                    Label = result[^1].Label,
                    Content = result[^1].Content + step.Content,
                };
            }
            else
            {
                result.Add(new AiReasoningStep { Label = step.Label, Content = step.Content });
            }
        }
        return result;
    }

    /// <summary>
    /// 审批/拒绝/临时批准挂起的工具调用（纯决策接口，不返回 SSE）。
    /// 执行工具（或授予提权）后通过门闩唤醒原 SSE 流的等待循环继续推送。
    /// 返回 false 表示没有匹配的挂起调用。
    /// </summary>
    public async Task<bool> ResolveApprovalAsync(
        string sessionId, string toolCallId, bool approved,
        CancellationToken ct = default, string permit = "one-time")
    {
        var state = _runs.TryGetValue(sessionId, out var r) ? r : null;
        if (state == null)
        {
            _logger.LogWarning("ResolveApproval: no run state for session {Session}", sessionId);
            return false;
        }
        var pendingCallId = state.PendingToolCall?["toolCallId"]?.GetValue<string>();
        if (pendingCallId != toolCallId)
        {
            _logger.LogWarning("ResolveApproval: pending call {Pending} != {Call} (session {Session})", pendingCallId, toolCallId, sessionId);
            return false;
        }

        var pending = state.ToolCalls.FirstOrDefault(t => t.Id == toolCallId);
        if (pending == null)
        {
            _logger.LogWarning("ResolveApproval: tool call {Call} not found in state (session {Session})", toolCallId, sessionId);
            return false;
        }
        _logger.LogInformation("ResolveApproval: matched pending call {Call} (session {Session}), approved={Approved}, permit={Permit}",
            toolCallId, sessionId, approved, permit);

        // 先取出挂起元数据（kind/requiredTier），再清空 PendingToolCall，
        // 否则下方 escalation 分支永远读不到 kind。
        var pendingKind = state.PendingToolCall["kind"]?.GetValue<string>() ?? "";
        var requiredTier = state.PendingToolCall["requiredTier"]?.GetValue<int>() ?? (int)JustitiaTier.Imperium;
        state.PendingToolCall = null;

        var provider = await GetProviderAsync(state.ProviderId, includeKey: true, ct);
        if (provider == null)
        {
            CleanupRunIfFinished(state, sessionId);
            return false;
        }

        // 已预置 assistant tool_calls 消息，补 tool 结果。
        if (state.LlmMessages.LastOrDefault(m => m["role"]?.GetValue<string>() == "assistant" && m["tool_calls"] != null) is JsonObject asst)
        {
            // 已存在（RunChatAsync 挂起时已添加），无需重复添加。
        }
        else
        {
            state.LlmMessages.Add(new JsonObject
            {
                ["role"] = "assistant",
                ["content"] = state.TurnText,
                ["tool_calls"] = new JsonArray { new JsonObject { ["id"] = toolCallId, ["type"] = "function", ["function"] = new JsonObject { ["name"] = pending.ToolName, ["arguments"] = pending.ArgsText } } },
            });
        }

        string output;
        if (!approved)
        {
            // 拒绝：以普通工具结果返回给 LLM，AI 基于"被拒绝"继续回话。
            output = McpUtils.Error("rejected by operator");
            // 审批拒绝留痕（风险等级按所需档位计）。
            await AuditAiToolAsync(state, pending.ToolName,
                JsonNode.Parse(pending.ArgsText) as JsonObject ?? new JsonObject(),
                "rejected by operator", success: false, permit: permit);
        }
        else
        {
            // 批准 → 若是档位提升请求（escalation），按许可时长授予临时提升：
            //   one-time：仅本次调用执行（不改变已有许可窗口，后续同档工具仍需审批）；
            //   5min/20min：提升 EffectiveTier，窗口内同档工具直接执行，到期回落。
            if (pendingKind == "escalation")
            {
                switch (permit)
                {
                    case "5min":
                        state.BoostTier = requiredTier;
                        state.BoostExpiresAt = DateTime.UtcNow.AddMinutes(5);
                        break;
                    case "20min":
                        state.BoostTier = requiredTier;
                        state.BoostExpiresAt = DateTime.UtcNow.AddMinutes(20);
                        break;
                    default: // "one-time"：不动已有许可窗口，仅本次执行。
                        break;
                }
            }

            // request_tier_elevation：提升本身即结果，无真实工具可执行。
            if (pending.ToolName == "request_tier_elevation")
            {
                output = McpUtils.Ok(new
                {
                    status = "elevation-granted",
                    tier = state.EffectiveTier.ToString().ToLowerInvariant(),
                    permit,
                    expiresAt = state.BoostExpiresAt?.ToUniversalTime().ToString("o"),
                });
                // 档位提升留痕（风险按提升后的档位计）。
                await AuditAiToolAsync(state, pending.ToolName,
                    JsonNode.Parse(pending.ArgsText) as JsonObject ?? new JsonObject(),
                    output, success: true, permit: permit);
            }
            else
            {
                // 普通工具：执行并把结果交给 LLM（与 ChatLoopAsync 直接执行路径一致）。
                // 审批由控制台/IM 回调触发，AsyncLocal 上下文不流动——从运行态恢复频道上下文。
                var prevCtx = AiRunContext.Current;
                if (state.ChannelContext != null) AiRunContext.Set(state.ChannelContext);
                try
                {
                    output = await InvokeToolAsync(pending.ToolName, JsonNode.Parse(pending.ArgsText) as JsonObject ?? new JsonObject(), ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "AI tool {Tool} threw unhandled exception after approval", pending.ToolName);
                    output = McpUtils.Error($"tool '{pending.ToolName}' failed: {ex.Message}");
                }
                finally
                {
                    if (prevCtx != null) AiRunContext.Set(prevCtx); else AiRunContext.Clear();
                }
                // 审批后执行的工具审计（风险按提升后的档位计）。
                var isErr = output.Contains("\"error\"", StringComparison.Ordinal);
                await AuditAiToolAsync(state, pending.ToolName,
                    JsonNode.Parse(pending.ArgsText) as JsonObject ?? new JsonObject(),
                    output, !isErr, permit);
            }
        }

        // 把决策结果作为该工具调用的结果写入 LlmMessages，
        // 并唤醒 WaitForApprovalAsync 的等待循环继续跑（普通 MCP 等待语义）。
        state.LlmMessages.Add(new JsonObject { ["role"] = "tool", ["tool_call_id"] = toolCallId, ["content"] = output });
        if (_approvalGates.TryGetValue(toolCallId, out var gate))
            gate.TrySetResult(output);
        return true;
    }

    /// <summary>续跑结束后若没有新的待审批调用，释放 CTS 并从运行表移除。</summary>
    private void CleanupRunIfFinished(AiRunState state, string sessionId)
    {
        if (state.PendingToolCall == null)
        {
            state.Cts?.Dispose();
            state.Finished = true;
            // 竞态防御：仅当 _runs 仍指向当前 state 才移除（防误删新运行）。
            if (_runs.TryGetValue(sessionId, out var current) && ReferenceEquals(current, state))
                _runs.TryRemove(sessionId, out _);
        }
    }

    /// <summary>停止当前运行。</summary>
    public void StopRun(string sessionId)
    {
        if (_runs.TryGetValue(sessionId, out var state))
            state.Cts?.Cancel();
    }

    private async Task SaveSessionAsync(AiSession session, CancellationToken ct)
    {
        session.UpdatedAt = DateTime.UtcNow;
        await Sessions.ReplaceOneAsync(
            x => x.Id == session.Id && x.UserId == session.UserId,
            session,
            new ReplaceOptions { IsUpsert = false },
            ct);
    }

    // ── 密钥保护（与 JwtSettings 一致：Windows DPAPI CurrentUser）─────────

    public static string EncryptKey(string plain)
    {
        var bytes = Encoding.UTF8.GetBytes(plain);
        if (OperatingSystem.IsWindows())
        {
            try
            {
                return Convert.ToBase64String(System.Security.Cryptography.ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser));
            }
            catch { /* fallthrough */ }
        }
        return Convert.ToBase64String(bytes);
    }

    public static string DecryptKey(string enc)
    {
        var bytes = Convert.FromBase64String(enc);
        if (OperatingSystem.IsWindows())
        {
            try
            {
                return Encoding.UTF8.GetString(System.Security.Cryptography.ProtectedData.Unprotect(bytes, null, DataProtectionScope.CurrentUser));
            }
            catch { /* fallthrough */ }
        }
        return Encoding.UTF8.GetString(bytes);
    }
}
