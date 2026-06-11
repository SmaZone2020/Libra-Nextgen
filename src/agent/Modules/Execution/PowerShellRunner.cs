using System.Diagnostics;
using System.Management.Automation;
using System.Text;

namespace LibraNextgen.Agent.Modules.Execution;

public static class PowerShellRunner
{
    private static bool? _runspaceAvailable;

    public static bool IsRunspaceAvailable
    {
        get
        {
            if (_runspaceAvailable.HasValue) return _runspaceAvailable.Value;
            try
            {
                using var ps = PowerShell.Create();
                ps.AddScript("Write-Output 'test'");
                var results = ps.Invoke();
                _runspaceAvailable = true;
            }
            catch (PlatformNotSupportedException)
            {
                _runspaceAvailable = false;
            }
            catch
            {
                _runspaceAvailable = false;
            }
            return _runspaceAvailable.Value;
        }
    }

    /// <summary>
    /// Execute PowerShell script in-memory via Runspace (no powershell.exe child process).
    /// Falls back to powershell.exe -EncodedCommand if Runspace is unavailable (e.g. Native AOT).
    /// </summary>
    public static async Task<string> ExecuteAsync(string script, CancellationToken ct = default)
    {
        if (IsRunspaceAvailable)
            return await ExecuteInMemoryAsync(script, ct);

        return await ExecuteViaProcessAsync(script, ct);
    }

    private static Task<string> ExecuteInMemoryAsync(string script, CancellationToken ct)
    {
        return Task.Run(() =>
        {
            try
            {
                using var ps = PowerShell.Create();
                ps.AddScript("$ErrorActionPreference = 'Continue'");
                ps.AddScript(script);

                var sb = new StringBuilder();
                var results = ps.Invoke();

                foreach (var result in results)
                {
                    if (result != null)
                        sb.AppendLine(result.ToString());
                }

                // Also collect errors
                if (ps.HadErrors)
                {
                    foreach (var err in ps.Streams.Error)
                    {
                        sb.AppendLine($"[ERROR] {err}");
                    }
                }

                // Collect verbose/debug/warning streams
                foreach (var v in ps.Streams.Warning)
                    sb.AppendLine($"[WARNING] {v}");
                foreach (var v in ps.Streams.Verbose)
                    sb.AppendLine($"[VERBOSE] {v}");

                return sb.Length > 0 ? sb.ToString().TrimEnd() : "[PowerShell completed with no output]";
            }
            catch (Exception ex)
            {
                return $"[PowerShell error: {ex.Message}]";
            }
        }, ct);
    }

    private static async Task<string> ExecuteViaProcessAsync(string script, CancellationToken ct)
    {
        var base64 = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {base64}",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = "C:\\",
        };

        using var process = Process.Start(psi);
        if (process == null) return "[Failed to start PowerShell process]";

        var output = await process.StandardOutput.ReadToEndAsync(ct);
        var error = await process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);

        if (!string.IsNullOrEmpty(error))
            output += "\n[STDERR]\n" + error;

        return string.IsNullOrEmpty(output) ? "[PowerShell completed with no output]" : output.TrimEnd();
    }
}
