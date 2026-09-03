namespace LibraNextgen.Service.Services;

public sealed class AiRunContextState
{
    public required string ChannelId { get; init; }
    public required string ChannelType { get; init; }
    public required string ExternalId { get; init; }
}

/// <summary>
/// </summary>
public static class AiRunContext
{
    private static readonly AsyncLocal<AiRunContextState?> CurrentState = new();

    public static AiRunContextState? Current => CurrentState.Value;

    public static void Set(AiRunContextState state) => CurrentState.Value = state;

    public static void Clear() => CurrentState.Value = null;
}
