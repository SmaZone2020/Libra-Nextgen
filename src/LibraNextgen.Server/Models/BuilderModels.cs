using LibraNextgen.Common.Models;

namespace LibraNextgen.Service.Models;

/// <summary>Persisted build history record.</summary>
public class BuildRecord
{
    public string Id { get; set; } = "";
    public string Platform { get; set; } = "x64";
    public BuildConfigRequest? Config { get; set; }
    public string FileName { get; set; } = "";
    public long FileSize { get; set; }
    public string Status { get; set; } = "building"; // building, completed, failed
    public string? Error { get; set; }
    public string CreatedAt { get; set; } = "";
    public string? CompletedAt { get; set; }
}

/// <summary>In-memory state for one in-flight build job.</summary>
public class BuildJob
{
    private readonly List<string> _logs = new();
    private readonly object _lock = new();

    public BuildRecord Record { get; set; } = null!;
    public bool IsCompleted { get; private set; }

    public void Log(string line)
    {
        lock (_lock) { _logs.Add(line); }
    }

    public List<string> GetLogs()
    {
        lock (_lock) { return _logs.ToList(); }
    }

    public void Complete(long fileSize)
    {
        IsCompleted = true;
        Record.Status = "completed";
        Record.FileSize = fileSize;
        Record.CompletedAt = DateTime.UtcNow.ToString("o");
    }

    public void Fail(string error)
    {
        IsCompleted = true;
        Record.Status = "failed";
        Record.Error = error;
        Record.CompletedAt = DateTime.UtcNow.ToString("o");
    }
}

public class ModuleBuildResult
{
    public bool Compiled { get; set; }
    public List<string> Missing { get; set; } = new();
    public List<string> Deployed { get; set; } = new();
    public List<string> Disabled { get; set; } = new();
}

/// <summary>Canonical builder platform registry (key → rust target os + arch short name).</summary>
public static class BuildPlatforms
{
    public const string WindowsX64 = "x64";
    public const string WindowsX86 = "x86";
    public const string WindowsArm64 = "win-arm64";
    public const string LinuxX64 = "linux-x64";
    public const string LinuxArm64 = "linux-arm64";
    public const string MacArm64 = "mac-arm64";

    /// <summary>All supported platform keys, stable order (primary → niche).</summary>
    public static readonly string[] All = [WindowsX64, WindowsX86, WindowsArm64, LinuxX64, LinuxArm64, MacArm64];

    /// <summary>Platform key → (rust target os, arch short name).</summary>
    public static readonly Dictionary<string, (string Os, string Arch)> Specs = new()
    {
        [WindowsX64] = ("windows", "x64"),
        [WindowsX86] = ("windows", "x86"),
        [WindowsArm64] = ("windows", "arm64"),
        [LinuxX64] = ("linux", "x64"),
        [LinuxArm64] = ("linux", "arm64"),
        [MacArm64] = ("macos", "arm64"),
    };

    /// <summary>
    /// Map the OS/arch strings a beacon reports (std::env::consts::{OS, ARCH} or
    /// os-release output) to a platform key, or null when unrecognized.
    /// Intel Macs (x86_64 darwin) are intentionally not mapped — M-chip only.
    /// </summary>
    public static string? MapOsArch(string osVersion, string arch)
    {
        var os = osVersion ?? string.Empty;
        var a = arch ?? string.Empty;
        var isArm = a.Contains("aarch64", StringComparison.OrdinalIgnoreCase)
                 || a.Contains("arm64", StringComparison.OrdinalIgnoreCase);
        var is86 = !isArm && a.Contains("86", StringComparison.OrdinalIgnoreCase);
        var is64 = a.Contains("64", StringComparison.OrdinalIgnoreCase);

        if (os.Contains("linux", StringComparison.OrdinalIgnoreCase))
            return isArm ? LinuxArm64 : LinuxX64;
        if (os.Contains("darwin", StringComparison.OrdinalIgnoreCase) ||
            os.Contains("macos", StringComparison.OrdinalIgnoreCase))
            return MacArm64;
        if (os.Contains("windows", StringComparison.OrdinalIgnoreCase) ||
            os.Contains("win32", StringComparison.OrdinalIgnoreCase))
            return isArm ? WindowsArm64 : is86 && !is64 ? WindowsX86 : WindowsX64;
        return null;
    }
}


public class BuildListItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Value { get; set; } = "";
    public bool Enabled { get; set; } = true;
}

public class BuildTrafficLists
{
    public string Id { get; set; } = "traffic";
    public List<BuildListItem> UserAgents { get; set; } = new();
    public List<BuildListItem> ExtraHeaders { get; set; } = new();
    public List<BuildListItem> PathSuffixes { get; set; } = new();
}

public record AddBuildListItemRequest(string List, string Value);

public record ToggleBuildListItemRequest(string List, string Id, bool Enabled);

public record DeleteBuildListItemRequest(string List, string Id);

internal record struct ProcessResult(int ExitCode, string Stdout, string Stderr);
