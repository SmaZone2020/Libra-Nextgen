namespace LibraNextgen.Common.Models;

/// <summary>
/// 内置 AI 助手：LLM 供应商配置。API Key 使用 DPAPI（Windows CurrentUser）
/// 加密后存储，读取时解密；非 Windows 平台回退为明文（与 JwtSettings 一致）。
/// </summary>
public class AiProvider
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    /// <summary>openai-compatible 兼容厂商类型（openai / deepseek / custom …）。</summary>
    public string ProviderType { get; set; } = "openai-compatible";
    /// <summary>API 基础地址，如 https://api.deepseek.com/v1（留空时按类型给默认值）。</summary>
    public string BaseUrl { get; set; } = "";
    /// <summary>加密后的 API Key。</summary>
    public string ApiKeyEnc { get; set; } = "";
    /// <summary>可用模型列表。</summary>
    public List<string> Models { get; set; } = new();
    /// <summary>默认模型。</summary>
    public string DefaultModel { get; set; } = "";
    /// <summary>是否启用（禁用后不可被会话选择）。</summary>
    public bool Enabled { get; set; } = true;
    /// <summary>工具调用是否需要人工审批（C2 场景建议开启，默认开）。</summary>
    public bool RequireApproval { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// AI 会话（持久化到 MongoDB，按用户隔离）。
/// 频道会话（IM 接入）通过 Channel* 平面字段与控制台会话区分：
/// ChannelId == null → 控制台会话；非 null → 频道会话（附类型 / 外部用户 ID / 外部昵称）。
/// </summary>
public class AiSession
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string UserId { get; set; } = "";
    public string UserName { get; set; } = "";
    public string Title { get; set; } = "新对话";
    public string ProviderId { get; set; } = "";
    public string Model { get; set; } = "";
    public List<AiMessage> Messages { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>频道 ID（ai_channels.Id）。null = 控制台会话。</summary>
    public string? ChannelId { get; set; }
    /// <summary>频道类型：telegram | lark | wechat-claw。</summary>
    public string? ChannelType { get; set; }
    /// <summary>频道侧外部用户 ID（Telegram chatId / 飞书 open_id / 微信 wxid）。</summary>
    public string? ChannelExternalId { get; set; }
    /// <summary>频道侧外部用户昵称。</summary>
    public string? ChannelExternalName { get; set; }
}

/// <summary>AI 频道（IM 接入配置，管理员在控制台管理；敏感配置项静态加密存储）。</summary>
public class AiChannel
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    /// <summary>telegram | lark | wechat-claw。</summary>
    public string ChannelType { get; set; } = "telegram";
    public bool Enabled { get; set; } = true;
    /// <summary>类型相关配置。敏感项（botToken/appSecret/encryptKey/ilinkKey）以 AiService.EncryptKey 加密后落库。</summary>
    public Dictionary<string, string> Config { get; set; } = new();
    /// <summary>该频道会话的 Justitia 基准档位（0=Cognitio … 3=Dictatura），服务端强制校验。</summary>
    public int DefaultTier { get; set; } = 0;
    /// <summary>是否强制绑定控制台账号（默认开；未绑定用户仅能收到 /bind 指引）。</summary>
    public bool RequireBind { get; set; } = true;
    /// <summary>默认 AI 供应商（空 = 取第一个启用供应商）。</summary>
    public string DefaultProviderId { get; set; } = "";
    /// <summary>默认模型（空 = 供应商默认模型）。</summary>
    public string DefaultModel { get; set; } = "";
    /// <summary>频道消息中是否显示工具调用标记（🔧 调用工具 / ⚠️ 执行失败）。默认开。</summary>
    public bool ShowToolCalls { get; set; } = true;
    /// <summary>流式输出：AI 生成时实时发送/编辑消息，而非完成后一次性输出。默认关。</summary>
    public bool StreamOutput { get; set; } = false;
    /// <summary>
    /// 是否允许在群组中调用（Telegram）：开启后群组消息仅响应 @提及 bot 的
    /// 消息与未绑定用户的 /bind 命令，且仅已绑定账户可对话。默认关。
    /// </summary>
    public bool AllowInGroups { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>频道侧身份 ↔ 控制台账号绑定关系。</summary>
public class AiChannelUser
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string ChannelId { get; set; } = "";
    /// <summary>Telegram chatId / 飞书 open_id / 微信 wxid。</summary>
    public string ExternalId { get; set; } = "";
    /// <summary>IM 侧昵称（展示用）。</summary>
    public string ExternalName { get; set; } = "";
    public string BoundUserId { get; set; } = "";
    public string BoundUserName { get; set; } = "";
    /// <summary>可选：按用户覆盖频道默认档位（null = 用频道 DefaultTier）。</summary>
    public int? TierOverride { get; set; }
    /// <summary>绑定码 SHA-256 哈希（一次性，15 分钟过期）。</summary>
    public string? BindCodeHash { get; set; }
    public DateTime? BindCodeExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime BoundAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// 一次性绑定码：管理员为指定控制台账号生成，用户在 IM 中发 /bind &lt;code&gt; 完成绑定。
/// 只存 SHA-256 哈希；15 分钟过期；成功后立即作废。
/// </summary>
public class AiChannelBindCode
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string ChannelId { get; set; } = "";
    /// <summary>绑定目标控制台账号。</summary>
    public string BoundUserId { get; set; } = "";
    public string BoundUserName { get; set; } = "";
    /// <summary>绑定码 SHA-256 哈希。</summary>
    public string CodeHash { get; set; } = "";
    /// <summary>绑定码明文尾 4 位（列表展示用，非敏感）。</summary>
    public string CodeTail { get; set; } = "";
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddMinutes(15);
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UsedAt { get; set; }
    /// <summary>管理员作废时间（作废后不可再绑定）。</summary>
    public DateTime? RevokedAt { get; set; }
    public string? UsedByExternalId { get; set; }
    public string? UsedByExternalName { get; set; }
}

/// <summary>
/// 频道轮询游标（Telegram update_id / iLink get_updates_buf）持久化：
/// 服务重启后从库恢复，避免 Telegram 重放 24 小时内未确认的更新。
/// </summary>
public class AiChannelCursor
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string ChannelId { get; set; } = "";
    public string Cursor { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// AI 事件订阅：Agent 上线/下线等系统事件触发后，由 Justitia 以系统视角接收事件信息，
/// 生成提醒并送达目标（控制台会话或 IM 频道）。
/// </summary>
public class AiEventSubscription
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    /// <summary>订阅的事件：agent.online | agent.offline。</summary>
    public List<string> Events { get; set; } = new();
    /// <summary>送达目标类型：session（控制台会话）| channel（IM 频道）。</summary>
    public string TargetType { get; set; } = "session";
    /// <summary>目标 id：会话 id 或频道 id。</summary>
    public string TargetId { get; set; } = "";
    /// <summary>会话目标所属用户 id（会话按用户隔离；频道目标为空）。</summary>
    public string? TargetUserId { get; set; }
    public string CreatedBy { get; set; } = "";
    public string CreatedByName { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>AI 会话中的一条消息。</summary>
public class AiMessage
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    /// <summary>user / assistant / system / tool。</summary>
    public string Role { get; set; } = "user";
    public string Content { get; set; } = "";
    /// <summary>assistant 的推理过程（链式思考步骤）。</summary>
    public List<AiReasoningStep>? Reasoning { get; set; }
    /// <summary>assistant 的工具调用（含状态）。</summary>
    public List<AiToolCall>? ToolCalls { get; set; }
    /// <summary>引用的来源。</summary>
    public List<AiSource>? Sources { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class AiReasoningStep
{
    public string Label { get; set; } = "";
    public string Content { get; set; } = "";
}

public class AiToolCall
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string ToolName { get; set; } = "";
    public string ArgsText { get; set; } = "{}";
    /// <summary>running / output-available / error / requires-action / input-streaming。</summary>
    public string State { get; set; } = "running";
    public string? Output { get; set; }
    /// <summary>该工具调用发生时已累积的助手文本（用于前端把工具调用穿插在文本流中）。</summary>
    public string? TextBefore { get; set; }
    public string? Error { get; set; }
}

public class AiSource
{
    public string Title { get; set; } = "";
    public string SourceType { get; set; } = "document"; // url | document
    public string? Url { get; set; }
    public string? Description { get; set; }
}

/// <summary>AI 与 MCP 的连接配置（单文档）。</summary>
public class AiMcpConfig
{
    public string Id { get; set; } = "default";
    /// <summary>是否把 MCP 工具暴露给 AI 调用。</summary>
    public bool ToolsEnabled { get; set; } = true;
    /// <summary>可被 AI 调用的工具名白名单（空 = 全部）。</summary>
    public List<string> AllowedTools { get; set; } = new();
}
