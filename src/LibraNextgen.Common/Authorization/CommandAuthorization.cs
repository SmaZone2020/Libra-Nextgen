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
        CommandType.LocalAccounts or
        CommandType.Kill or
        CommandType.KillAndClean or
        CommandType.Restart => true,
        _ => false,
    };
}
