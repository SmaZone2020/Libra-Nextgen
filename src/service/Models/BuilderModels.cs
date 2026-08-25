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

/// <summary>Rust cross-compile target OS (platform key → os).</summary>
public static class BuildPlatforms
{
    public const string WindowsX64 = "x64";
    public const string WindowsX86 = "x86";
    public const string LinuxX64 = "linux-x64";
}

// ── 流量伪装持久化列表（服务端存储，构建时取启用项）─────────────────────

public class BuildListItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Value { get; set; } = "";
    public bool Enabled { get; set; } = true;
}

/// <summary>流量伪装三组列表（单文档持久化，Id 固定 "traffic"）。</summary>
public class BuildTrafficLists
{
    public string Id { get; set; } = "traffic";
    public List<BuildListItem> UserAgents { get; set; } = new();
    public List<BuildListItem> ExtraHeaders { get; set; } = new();
    public List<BuildListItem> PathSuffixes { get; set; } = new();
}

/// <summary>增加流量伪装项请求体。</summary>
public record AddBuildListItemRequest(string List, string Value);

/// <summary>切换流量伪装项启用状态请求体。</summary>
public record ToggleBuildListItemRequest(string List, string Id, bool Enabled);

/// <summary>删除流量伪装项请求体。</summary>
public record DeleteBuildListItemRequest(string List, string Id);

internal record struct ProcessResult(int ExitCode, string Stdout, string Stderr);
