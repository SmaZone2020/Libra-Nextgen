using LibraNextgen.Common.Models;

namespace LibraNextgen.Service.Services.Agents;

/// <summary>
/// Per-agent heartbeat timing derived from the interval the agent declares at
/// registration. Offline detection tolerates a fixed 5s grace over that interval.
/// </summary>
public static class HeartbeatTiming
{
    public const long OfflineGraceMs = 5_000;
    public const long MinIntervalMs = 500;
    public const long MaxIntervalMs = 86_400_000;

    public static long ResolveIntervalMs(RegisterRequest request, int fallbackSeconds)
    {
        if (request.HeartbeatIntervalMs is > 0)
            return Math.Clamp(request.HeartbeatIntervalMs.Value, MinIntervalMs, MaxIntervalMs);
        return Math.Max(1, fallbackSeconds) * 1_000L;
    }

    public static long GetIntervalMs(Agent agent)
    {
        if (agent.HeartbeatIntervalMs > 0)
            return agent.HeartbeatIntervalMs;
        return Math.Max(1, agent.HeartbeatInterval) * 1_000L;
    }

    public static int GetIntervalSeconds(Agent agent) =>
        (int)Math.Ceiling(GetIntervalMs(agent) / 1_000.0);

    public static TimeSpan GetOfflineTimeout(Agent agent) =>
        TimeSpan.FromMilliseconds(GetIntervalMs(agent) + OfflineGraceMs);
}
