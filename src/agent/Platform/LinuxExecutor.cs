using System.Diagnostics;

namespace LibraNextgen.Agent.Platform;

public class LinuxExecutor : IPlatformExecutor
{
    private readonly string _shell;

    public LinuxExecutor()
    {
        _shell = File.Exists("/bin/bash") ? "/bin/bash" :
                 File.Exists("/bin/zsh") ? "/bin/zsh" : "/bin/sh";
    }

    public string GetDefaultShell() => _shell;

    public bool IsAvailable() => OperatingSystem.IsLinux() || OperatingSystem.IsMacOS();

    public async Task<string> ExecuteAsync(string command, CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo
        {
            FileName = _shell,
            Arguments = $"-c \"{command.Replace("\"", "\\\"")}\"",
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

    public InteractiveShellHandle StartInteractiveShell()
    {
        var psi = new ProcessStartInfo
        {
            FileName = _shell,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = "/"
        };

        var cts = new CancellationTokenSource();
        var process = Process.Start(psi)!;
        return new InteractiveShellHandle { Process = process, Cts = cts };
    }

    public string[] GetDrives()
    {
        var drives = new List<string> { "/" };
        try
        {
            if (Directory.Exists("/mnt"))
                drives.AddRange(Directory.GetDirectories("/mnt"));
            if (Directory.Exists("/media"))
                drives.AddRange(Directory.GetDirectories("/media"));
        }
        catch { /* ignore */ }
        return drives.ToArray();
    }
}
