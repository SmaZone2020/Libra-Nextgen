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

/// <summary>AI 会话（持久化到 MongoDB，按用户隔离）。</summary>
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
