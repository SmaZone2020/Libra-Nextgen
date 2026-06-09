using System.Diagnostics;

namespace LibraNextgen.Agent.Platform;

public class WindowsExecutor : IPlatformExecutor
{
    public string GetDefaultShell() => "cmd.exe";

    public bool IsAvailable() => OperatingSystem.IsWindows();

    public async Task<string> ExecuteAsync(string command, CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c {command}",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi);
        if (process == null) return "Failed to start process";

        var output = await process.StandardOutput.ReadToEndAsync(ct);
        var error = await process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);

        return string.IsNullOrEmpty(output) ? error : output;
    }
}
