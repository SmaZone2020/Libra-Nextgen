using System.Diagnostics;
using System.Globalization;
using System.Text;
using Microsoft.Win32;

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
            // Query system OEM code page from registry — most reliable for cmd.exe output encoding.
            // CurrentCulture.OEMCodePage can be wrong (e.g. 437) when user locale differs from system locale.
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SYSTEM\CurrentControlSet\Control\Nls\CodePage");
            var oemCpStr = key?.GetValue("OEMCP")?.ToString();
            if (int.TryParse(oemCpStr, out var oemCp) && oemCp > 0)
            {
                var enc = Encoding.GetEncoding(oemCp);
                Console.WriteLine($"[WindowsExecutor] System OEM CP: {oemCp} ({enc.EncodingName})");
                return enc;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[WindowsExecutor] Registry OEM CP lookup failed: {ex.Message}");
        }

        try
        {
            var oemCp = CultureInfo.CurrentCulture.TextInfo.OEMCodePage;
            Console.WriteLine($"[WindowsExecutor] Fallback OEM CP: {oemCp}");
            return Encoding.GetEncoding(oemCp);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[WindowsExecutor] OEM encoding failed: {ex.Message}, using UTF-8");
            return Encoding.UTF8;
        }
    }
}
