using System.ComponentModel;
using ModelContextProtocol.Server;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// 权限提升请求工具（§6 Writ of Request 的正式通道）。
/// 调用 request_tier_elevation 会把请求转成审批挂起（kind=escalation），
/// 由 Operator 通过审批模态框批准（一次性 / 5min / 20min 临时提升）或拒绝。
/// 该工具本身不执行任何动作——真正的档位提升由 AiService 的
/// JustitiaPolicy/ResolveApprovalAsync 完成。
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
        // 正常流程中不会执行到这里：AiService 会在档位拦截层把该调用
        // 转为审批挂起（kind=escalation），批准后按许可时长提升档位。
        // 此处兜底返回说明，避免被反射直接调用时产生空结果。
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
