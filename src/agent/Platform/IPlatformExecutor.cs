namespace LibraNextgen.Agent.Platform;

public interface IPlatformExecutor
{
    Task<string> ExecuteAsync(string command, CancellationToken ct = default);
    string GetDefaultShell();
    bool IsAvailable();
}
