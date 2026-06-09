using System.Diagnostics;

namespace LibraNextgen.Agent.Modules.Execution;

public static class ShellCommand
{
    public static async Task<string> ExecuteAsync(string command, int timeoutMs = 30000, CancellationToken ct = default)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeoutMs);

        try
        {
            var shell = OperatingSystem.IsWindows() ? "cmd.exe" : "/bin/bash";
            var args = OperatingSystem.IsWindows() ? $"/c {command}" : $"-c \"{command.Replace("\"", "\\\"")}\"";

            var psi = new ProcessStartInfo
            {
                FileName = shell,
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null) return "Failed to start process";

            var outputTask = process.StandardOutput.ReadToEndAsync(cts.Token);
            var errorTask = process.StandardError.ReadToEndAsync(cts.Token);

            await process.WaitForExitAsync(cts.Token);
            var output = await outputTask;
            var error = await errorTask;

            return string.IsNullOrEmpty(output) ? error : output;
        }
        catch (OperationCanceledException)
        {
            return "Command timed out";
        }
    }
}
