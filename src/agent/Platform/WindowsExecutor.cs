using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace LibraNextgen.Agent.Platform;

public class WindowsExecutor : IPlatformExecutor
{
    private static readonly Encoding OemEncoding = GetOemEncoding();

    public WindowsExecutor()
    {
        Console.WriteLine($"[WindowsExecutor] Using encoding: {OemEncoding.EncodingName} (code page: {OemEncoding.CodePage})");
    }

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
            CreateNoWindow = true,
            StandardOutputEncoding = OemEncoding,
            StandardErrorEncoding = OemEncoding,
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
            FileName = "cmd.exe",
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = "C:\\",
            StandardOutputEncoding = OemEncoding,
            StandardErrorEncoding = OemEncoding,
            StandardInputEncoding = OemEncoding,
        };

        return StartWithPsi(psi);
    }

    public string[] GetDrives()
    {
        try
        {
            return DriveInfo.GetDrives()
                .Where(d => d.IsReady)
                .Select(d => d.Name) // "C:\", "D:\"
                .ToArray();
        }
        catch
        {
            return ["C:\\"];
        }
    }

    private static InteractiveShellHandle StartWithPsi(ProcessStartInfo psi)
    {
        var cts = new CancellationTokenSource();
        var process = Process.Start(psi)!;
        return new InteractiveShellHandle { Process = process, Cts = cts };
    }

    private static Encoding GetOemEncoding()
    {
        try
        {
            var oemCp = CultureInfo.CurrentCulture.TextInfo.OEMCodePage;
            var enc = Encoding.GetEncoding(oemCp);
            Console.WriteLine($"[WindowsExecutor] OEM code page: {oemCp}, encoding: {enc.EncodingName}");
            return enc;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[WindowsExecutor] OEM encoding failed: {ex.Message}, falling back to UTF-8");
            return Encoding.UTF8;
        }
    }
}
