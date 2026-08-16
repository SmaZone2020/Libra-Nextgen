using LibraNextgen.Common.Models;

namespace LibraNextgen.Common.Authorization;

/// <summary>
/// Centralized authorization rules for sensitive operator actions.
/// Operators are restricted from high-impact commands; only Admins may run them.
/// </summary>
public static class CommandAuthorization
{
    public static bool RequiresAdmin(CommandType type) => type switch
    {
        CommandType.StressHttpFlood or
        CommandType.StressSynFlood or
        CommandType.StressUdpFlood or
        CommandType.StressIcmpFlood or
        CommandType.StressReflection or
        CommandType.StressSlowloris or
        CommandType.StressTcpConnFlood or
        CommandType.StressMalformed or
        CommandType.StressStop or
        CommandType.LocalAccounts or
        CommandType.Kill or
        CommandType.Screenshot or
        CommandType.Webcam => true,
        _ => false,
    };
}
