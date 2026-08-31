namespace LibraNextgen.Common.Models;

/// <summary>
/// </summary>
public class AiProvider
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public string ProviderType { get; set; } = "openai-compatible";
    public string BaseUrl { get; set; } = "";
    public string ApiKeyEnc { get; set; } = "";
    public List<string> Models { get; set; } = new();
    public string DefaultModel { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public bool RequireApproval { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
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

    /// <summary>Run state exposed to clients: idle("completed" for legacy docs) /
    /// responding while the AI is generating / error.</summary>
    public string Status { get; set; } = "completed";

    public string? ChannelId { get; set; }
    public string? ChannelType { get; set; }
    public string? ChannelExternalId { get; set; }
    public string? ChannelExternalName { get; set; }
}

public class AiChannel
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public string ChannelType { get; set; } = "telegram";
    public bool Enabled { get; set; } = true;
    public Dictionary<string, string> Config { get; set; } = new();
    public int DefaultTier { get; set; } = 0;
    public bool RequireBind { get; set; } = true;
    public string DefaultProviderId { get; set; } = "";
    public string DefaultModel { get; set; } = "";
    public bool ShowToolCalls { get; set; } = true;
    public bool StreamOutput { get; set; } = false;
    /// <summary>
    /// </summary>
    public bool AllowInGroups { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class AiChannelUser
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string ChannelId { get; set; } = "";
    public string ExternalId { get; set; } = "";
    public string ExternalName { get; set; } = "";
    public string BoundUserId { get; set; } = "";
    public string BoundUserName { get; set; } = "";
    public int? TierOverride { get; set; }
    public string? BindCodeHash { get; set; }
    public DateTime? BindCodeExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime BoundAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// </summary>
public class AiChannelBindCode
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string ChannelId { get; set; } = "";
    public string BoundUserId { get; set; } = "";
    public string BoundUserName { get; set; } = "";
    public string CodeHash { get; set; } = "";
    public string CodeTail { get; set; } = "";
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddMinutes(15);
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UsedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? UsedByExternalId { get; set; }
    public string? UsedByExternalName { get; set; }
}

/// <summary>
/// </summary>
public class AiChannelCursor
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string ChannelId { get; set; } = "";
    public string Cursor { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// </summary>
public class AiEventSubscription
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public List<string> Events { get; set; } = new();
    public string TargetType { get; set; } = "session";
    public string TargetId { get; set; } = "";
    public string? TargetUserId { get; set; }
    public string CreatedBy { get; set; } = "";
    public string CreatedByName { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class AiMessage
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Role { get; set; } = "user";
    public string Content { get; set; } = "";
    public List<AiReasoningStep>? Reasoning { get; set; }
    public List<AiToolCall>? ToolCalls { get; set; }
    public List<AiSource>? Sources { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>True while the AI is still generating this message (progress
    /// persisted for streaming visibility; replaced on completion).</summary>
    public bool Pending { get; set; }
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
    public string State { get; set; } = "running";
    public string? Output { get; set; }
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

public class AiMcpConfig
{
    public string Id { get; set; } = "default";
    public bool ToolsEnabled { get; set; } = true;
    public List<string> AllowedTools { get; set; } = new();
}
