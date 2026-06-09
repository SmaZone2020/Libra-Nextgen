using System.Runtime.InteropServices;

namespace LibraNextgen.Agent.AntiAnalysis;

public static class VmDetector
{
    public static bool IsVirtualMachine()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            return CheckWindowsVm();
        return CheckLinuxVm();
    }

    private static bool CheckWindowsVm()
    {
        // Check for common VM MAC address prefixes
        try
        {
            var output = ExecuteCommand("wmic", "nicconfig get macaddress");
            if (!string.IsNullOrEmpty(output))
            {
                var upper = output.ToUpperInvariant();
                if (upper.Contains("00:05:69") || upper.Contains("00:0C:29") ||
                    upper.Contains("00:1C:42") || upper.Contains("00:50:56") ||
                    upper.Contains("08:00:27"))
                    return true;
            }
        }
        catch { }

        // Check for VM-specific services
        try
        {
            var svc = ExecuteCommand("sc", "query vmtools");
            if (svc.Contains("RUNNING")) return true;

            svc = ExecuteCommand("sc", "query vboxservice");
            if (svc.Contains("RUNNING")) return true;
        }
        catch { }

        return false;
    }

    private static bool CheckLinuxVm()
    {
        try
        {
            var dmi = ExecuteCommand("/bin/sh", "-c \"cat /sys/class/dmi/id/product_name 2>/dev/null\"");
            if (!string.IsNullOrEmpty(dmi))
            {
                var lower = dmi.ToLowerInvariant();
                if (lower.Contains("virtualbox") || lower.Contains("vmware") ||
                    lower.Contains("kvm") || lower.Contains("qemu") ||
                    lower.Contains("xen"))
                    return true;
            }
        }
        catch { }
        return false;
    }

    private static string ExecuteCommand(string fileName, string arguments)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var proc = System.Diagnostics.Process.Start(psi);
            if (proc == null) return string.Empty;
            proc.WaitForExit(5000);
            return proc.StandardOutput.ReadToEnd();
        }
        catch
        {
            return string.Empty;
        }
    }
}
