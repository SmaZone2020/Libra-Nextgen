using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services.Ai;

public enum JustitiaTier
{
    Cognitio = 0,
    Arbitrium = 1,
    Imperium = 2,
    Dictatura = 3,
}

/// <summary>
/// </summary>
public static class JustitiaPolicy
{
    public static readonly string[] TierKeys = { "cognitio", "arbitrium", "imperium", "dictatura" };

    private static readonly Dictionary<string, JustitiaTier> ToolTiers = new(StringComparer.Ordinal)
    {
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

        ["rename_file"] = JustitiaTier.Arbitrium,
        ["move_file"] = JustitiaTier.Arbitrium,
        ["copy_file"] = JustitiaTier.Arbitrium,
        ["create_task"] = JustitiaTier.Arbitrium,
        ["cancel_task"] = JustitiaTier.Arbitrium,

        ["execute_shell"] = JustitiaTier.Imperium,
        ["execute_powershell"] = JustitiaTier.Imperium,
        ["execute_process"] = JustitiaTier.Imperium,
        ["spawn_process"] = JustitiaTier.Imperium,
        ["kill_process"] = JustitiaTier.Imperium,
        ["delete_file"] = JustitiaTier.Imperium,
        ["get_rdp_credentials"] = JustitiaTier.Imperium,
        ["get_ssh_keys"] = JustitiaTier.Imperium,
        ["plugin_call"] = JustitiaTier.Imperium,

        ["delete_agent"] = JustitiaTier.Dictatura,
    };

    public static JustitiaTier RequiredTier(string toolName) =>
        ToolTiers.TryGetValue(toolName, out var tier) ? tier : JustitiaTier.Cognitio;

    public static bool Allows(string toolName, JustitiaTier tier) => tier >= RequiredTier(toolName);

    public static JustitiaTier Parse(string? key) =>
        Enum.TryParse<JustitiaTier>(key, true, out var t) ? t : JustitiaTier.Cognitio;
}

public class JustitiaState
{
    public int Tier { get; set; }

    public int? BoostTier { get; set; }

    public DateTime? BoostExpiresAt { get; set; }

    public JustitiaTier Effective =>
        BoostTier is { } b && BoostExpiresAt is { } exp && exp > DateTime.UtcNow
            ? (JustitiaTier)b
            : (JustitiaTier)Tier;
}

public class JustitiaService
{
    private readonly ConcurrentDictionary<string, JustitiaState> _states = new();

    public JustitiaState Get(string userId) =>
        _states.TryGetValue(userId, out var s) ? s : new JustitiaState();

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

    public JustitiaState Boost(string userId, JustitiaTier tier)
    {
        var s = Get(userId);
        s.BoostTier = (int)tier;
        s.BoostExpiresAt = DateTime.UtcNow.AddMinutes(30);
        _states[userId] = s;
        return s;
    }
}
