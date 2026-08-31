using System.ComponentModel;
using ModelContextProtocol.Server;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// </summary>
[McpServerToolType]
public sealed class EscalationTools
{
    [McpServerTool, Description("Submit a formal request to temporarily elevate the Justitia tier for this session (e.g. ARBITRIUM → IMPERIUM/DICTATURA). Triggers the operator approval modal; no action executes until approved. Approved permits: one-time, 5 minutes, 20 minutes.")]
    public static string request_tier_elevation(
        [Description("The tier you need: cognitio, arbitrium, imperium, dictatura")] string requiredTier,
        [Description("Why you need the elevation")] string? rationale = null,
        [Description("Requested permit window in minutes: 5 or 20 (omit for one-time)")] int? ttlMinutes = null)
    {
        return McpUtils.Ok(new
        {
            status = "request-submitted",
            note = "awaiting operator approval",
            requiredTier,
            rationale,
            ttlMinutes,
        });
    }
}
