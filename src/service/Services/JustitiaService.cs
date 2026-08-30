using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

/// <summary>Justitia 权限档位（四档）。</summary>
public enum JustitiaTier
{
    /// <summary>Cognitio 审理：仅察不处 — 只读侦查，自主执行。</summary>
    Cognitio = 0,
    /// <summary>Arbitrium 裁量：衡而断之 — 常规任务，自主并通报。</summary>
    Arbitrium = 1,
    /// <summary>Imperium 治权：请命后行 — 高危操作，须人工批准。</summary>
    Imperium = 2,
    /// <summary>Dictatura 独裁：毋须请命 — 全权行动，仅管理员可启。</summary>
    Dictatura = 3,
}

/// <summary>
/// 工具 → 档位门槛（固定映射表，先跑通再考虑可配置化）。
/// 含义：要调用某工具，用户档位必须 ≥ 该工具的最低档位。
/// 档位在浏览器持久化，随 SSE 请求传上来；服务端按此强制校验（防绕过）。
/// </summary>
public static class JustitiaPolicy
{
    public static readonly string[] TierKeys = { "cognitio", "arbitrium", "imperium", "dictatura" };

    /// <summary>每个工具的最低档位（默认 Cognitio=0，即所有档位都可调用）。</summary>
    private static readonly Dictionary<string, JustitiaTier> ToolTiers = new(StringComparer.Ordinal)
    {
        // ── Cognitio (0) 只读侦查：列表/详情/只读信息 ──
        ["list_agents"] = JustitiaTier.Cognitio,
        ["get_agent"] = JustitiaTier.Cognitio,
        ["list_tasks"] = JustitiaTier.Cognitio,
        ["get_task"] = JustitiaTier.Cognitio,
        ["get_build_info"] = JustitiaTier.Cognitio,
        ["list_builds"] = JustitiaTier.Cognitio,
        ["list_directory"] = JustitiaTier.Cognitio,
        ["get_drives"] = JustitiaTier.Cognitio,
        ["get_processes"] = JustitiaTier.Cognitio,
        ["get_network_info"] = JustitiaTier.Cognitio,
        ["scan_lan"] = JustitiaTier.Cognitio,
        ["scan_wifi"] = JustitiaTier.Cognitio,

        // ── Arbitrium (1) 常规任务：文件整理 / 任务调度，自主并通报 ──
        ["rename_file"] = JustitiaTier.Arbitrium,
        ["move_file"] = JustitiaTier.Arbitrium,
        ["copy_file"] = JustitiaTier.Arbitrium,
        ["create_task"] = JustitiaTier.Arbitrium,
        ["cancel_task"] = JustitiaTier.Arbitrium,

        // ── Imperium (2) 高危操作：执行命令 / 凭据收集 / 文件删除，须人工批准 ──
        ["execute_shell"] = JustitiaTier.Imperium,
        ["execute_powershell"] = JustitiaTier.Imperium,
        ["execute_process"] = JustitiaTier.Imperium,
        ["spawn_process"] = JustitiaTier.Imperium,
        ["kill_process"] = JustitiaTier.Imperium,
        ["delete_file"] = JustitiaTier.Imperium,
        ["get_rdp_credentials"] = JustitiaTier.Imperium,
        ["get_ssh_keys"] = JustitiaTier.Imperium,
        // 插件服务端脚本在 TeamServer 上执行（可发网络请求）：默认按高危处理，须人工批准。
        ["plugin_call"] = JustitiaTier.Imperium,

        // ── Dictatura (3) 全权：删除设备 / 破坏性操作，仅管理员可启 ──
        ["delete_agent"] = JustitiaTier.Dictatura,
    };

    /// <summary>工具所需档位；未登记的工具默认 Cognitio（只读优先，安全默认）。</summary>
    public static JustitiaTier RequiredTier(string toolName) =>
        ToolTiers.TryGetValue(toolName, out var tier) ? tier : JustitiaTier.Cognitio;

    /// <summary>档位是否足以调用某工具。</summary>
    public static bool Allows(string toolName, JustitiaTier tier) => tier >= RequiredTier(toolName);

    /// <summary>档位 key ↔ enum（未知 key 回退 Cognitio，安全默认）。</summary>
    public static JustitiaTier Parse(string? key) =>
        Enum.TryParse<JustitiaTier>(key, true, out var t) ? t : JustitiaTier.Cognitio;
}

/// <summary>Justitia 权限档位（浏览器持久化，随请求传参）。</summary>
public class JustitiaState
{
    /// <summary>当前档位（0-3）。</summary>
    public int Tier { get; set; }

    /// <summary>会话内临时提升的档位（用户批准提升后生效，回到默认后失效）。</summary>
    public int? BoostTier { get; set; }

    /// <summary>提升后的到期时间（UTC）。</summary>
    public DateTime? BoostExpiresAt { get; set; }

    /// <summary>有效档位 = 未过期的临时提升档位，否则当前档位。</summary>
    public JustitiaTier Effective =>
        BoostTier is { } b && BoostExpiresAt is { } exp && exp > DateTime.UtcNow
            ? (JustitiaTier)b
            : (JustitiaTier)Tier;
}

/// <summary>Justitia 状态存储（浏览器持久化 → 随请求提交；此处仅做会话级暂存，不落库）。</summary>
public class JustitiaService
{
    private readonly ConcurrentDictionary<string, JustitiaState> _states = new();

    public JustitiaState Get(string userId) =>
        _states.TryGetValue(userId, out var s) ? s : new JustitiaState();

    /// <summary>设置档位（Dictatura 仅管理员）。</summary>
    public JustitiaState Set(string userId, JustitiaTier tier, bool isAdmin)
    {
        var s = Get(userId);
        if (tier == JustitiaTier.Dictatura && !isAdmin)
            throw new UnauthorizedAccessException("Dictatura tier requires Admin");
        s.Tier = (int)tier;
        s.BoostTier = null;
        s.BoostExpiresAt = null;
        _states[userId] = s;
        return s;
    }

    /// <summary>临时提升档位（一次性：批准后仅对后续未执行调用生效，回到默认档位即失效）。</summary>
    public JustitiaState Boost(string userId, JustitiaTier tier)
    {
        var s = Get(userId);
        s.BoostTier = (int)tier;
        s.BoostExpiresAt = DateTime.UtcNow.AddMinutes(30);
        _states[userId] = s;
        return s;
    }
}
