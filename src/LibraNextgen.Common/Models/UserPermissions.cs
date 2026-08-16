namespace LibraNextgen.Common.Models;

/// <summary>
/// Per-user access permissions. When <see cref="FullAccess"/> is false, the user
/// is restricted to the listed pages/actions.
/// </summary>
public class UserPermissions
{
    public bool FullAccess { get; set; } = true;

    /// <summary>Page keys the user may access (nav items).</summary>
    public List<string> AllowedPages { get; set; } = new();

    /// <summary>Action keys the user may perform (see RiskActions).</summary>
    public List<string> AllowedActions { get; set; } = new();
}
