namespace LibraNextgen.Service.Services;

/// <summary>当前 AI 运行携带的频道上下文（AsyncLocal）。</summary>
public sealed class AiRunContextState
{
    public required string ChannelId { get; init; }
    public required string ChannelType { get; init; }
    public required string ExternalId { get; init; }
}

/// <summary>
/// AI 运行上下文（AsyncLocal）：RunChatAsync 在频道会话运行时注入
/// （channelId/type/externalId），供 MCP 工具（如 send_channel_media）读取——
/// 工具无需用户显式传目标，只能发给"当前对话者"，天然防越权。
/// 控制台会话运行时为 null。
/// </summary>
public static class AiRunContext
{
    private static readonly AsyncLocal<AiRunContextState?> CurrentState = new();

    public static AiRunContextState? Current => CurrentState.Value;

    public static void Set(AiRunContextState state) => CurrentState.Value = state;

    public static void Clear() => CurrentState.Value = null;
}
