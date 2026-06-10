namespace LibraNextgen.Agent.Platform;

public interface IPlatformExecutor
{
    Task<string> ExecuteAsync(string command, CancellationToken ct = default);
    string GetDefaultShell();
    bool IsAvailable();

    /// <summary>Start an interactive shell process. Returns the Process handle.</summary>
    InteractiveShellHandle StartInteractiveShell();

    /// <summary>List all logical drives on this machine (Windows: C:\, D:\; Linux: /, /mnt/*).</summary>
    string[] GetDrives();
}

public class InteractiveShellHandle
{
    public System.Diagnostics.Process Process { get; init; } = null!;
    public CancellationTokenSource Cts { get; init; } = null!;
}
