using System.Text.Json;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Common.Authorization;

/// <summary>
/// Maps an audited HTTP operation (method + path + body) to a canonical action
/// key used by the risk policy. Returns null when the operation should not be
/// risk-scored (e.g. agent beacon traffic).
/// </summary>
public static class RiskClassifier
{
    public static string? ClassifyAction(string method, string path, string? body = null)
    {
        // Task creation — refine by command type from the request body.
        if (path.StartsWith("/api/tasks") && method == "POST")
            return ClassifyTask(body);

        if (path.StartsWith("/api/system"))
        {
            if (path.EndsWith("/processes/kill")) return RiskActions.SystemProcessKill;
            if (path.Contains("/windows")) return RiskActions.SystemWindows;
            if (path.Contains("/env")) return RiskActions.SystemEnv;
            if (path.Contains("/network")) return RiskActions.SystemNetwork;
            if (path.Contains("/lanscan")) return RiskActions.SystemLanScan;
            return RiskActions.SystemInfo;
        }

        if (path.StartsWith("/api/screen"))
            return RiskActions.ScreenMonitor;

        if (path.StartsWith("/api/media"))
            return path.Contains("/mic") ? RiskActions.Mic : RiskActions.Camera;

        if (path.StartsWith("/api/files"))
        {
            if (method == "DELETE") return RiskActions.FileDelete;
            if (path.EndsWith("/list")) return RiskActions.FileList;
            if (path.EndsWith("/read") || path.EndsWith("/download")) return RiskActions.FileRead;
            if (path.EndsWith("/write")) return RiskActions.FileWrite;
            if (path.EndsWith("/drives")) return RiskActions.FileDrives;
            if (path.EndsWith("/mkdir")) return RiskActions.FileMkdir;
            if (path.EndsWith("/rename")) return RiskActions.FileRename;
            if (path.EndsWith("/move")) return RiskActions.FileMove;
            if (path.EndsWith("/copy")) return RiskActions.FileCopy;
            if (path.EndsWith("/compress")) return RiskActions.FileCompress;
            if (path.EndsWith("/decompress")) return RiskActions.FileDecompress;
            if (path.EndsWith("/shortcut")) return RiskActions.FileShortcut;
            return RiskActions.FileList;
        }

        if (path.StartsWith("/api/othersoft"))
        {
            if (path.EndsWith("/wechat")) return RiskActions.Wechat;
            if (path.EndsWith("/ai")) return RiskActions.Ai;
            if (path.Contains("/browser/search")) return RiskActions.BrowserSearch;
            if (path.Contains("/browser")) return RiskActions.Browser;
            return RiskActions.Qq;
        }

        if (path.StartsWith("/api/proxy"))
            return RiskActions.Proxy;

        if (path.StartsWith("/api/agents"))
        {
            if (path.EndsWith("/kill-all")) return RiskActions.AgentKillAll;
            if (method == "DELETE") return RiskActions.AgentDelete;
        }

        // Only agent-targeting operations are audited / risk-scored. Account,
        // access-key, builder, auth and beacon traffic are not agent operations.
        return null;
    }

    private static string? ClassifyTask(string? body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return RiskActions.TaskCreate;

        try
        {
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("commandType", out var ct) || ct.ValueKind != JsonValueKind.String)
                return RiskActions.TaskCreate;

            return ct.GetString() switch
            {
                "Shell" or "PowerShell" => RiskActions.Shell,
                "Screenshot" => RiskActions.ScreenMonitor,
                "Webcam" => RiskActions.Camera,
                "LocalAccounts" or "CredDump" => RiskActions.Credentials,
                "FileList" => RiskActions.FileList,
                "FileDrives" => RiskActions.FileDrives,
                "Download" => RiskActions.FileRead,
                "Upload" => RiskActions.FileWrite,
                "Kill" => RiskActions.SystemProcessKill,
                "KillAndClean" => RiskActions.AgentKillAll,
                _ => RiskActions.TaskCreate,
            };
        }
        catch
        {
            return RiskActions.TaskCreate;
        }
    }
}
