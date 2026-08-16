namespace LibraNextgen.Common.Models;

/// <summary>
/// Risk assessment for an audited action. Configurable per-operation by Admins.
/// </summary>
public enum RiskLevel
{
    Safe = 0,
    Normal = 1,
    Dangerous = 2,
    Malicious = 3,
}
