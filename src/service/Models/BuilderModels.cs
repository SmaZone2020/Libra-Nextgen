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

/// <summary>Rust cross-compile target (triple + host OS).</summary>
public readonly record struct PlatformTarget(string Triple, string Os);

internal record struct ProcessResult(int ExitCode, string Stdout, string Stderr);
