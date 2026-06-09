using System.Runtime.InteropServices;

namespace LibraNextgen.Agent.Modules.Recon;

public static class SystemInfo
{
    public static string Collect()
    {
        var drives = DriveInfo.GetDrives()
            .Where(d => d.IsReady)
            .Select(d => $"{{\"name\":\"{Escape(d.Name)}\",\"format\":\"{d.DriveFormat}\",\"totalGb\":{d.TotalSize / (1024.0 * 1024 * 1024):F1},\"freeGb\":{d.AvailableFreeSpace / (1024.0 * 1024 * 1024):F1}}}");
        var drivesJson = string.Join(",", drives);

        return $$"""
            {"hostname":"{{Escape(Environment.MachineName)}}",
            "userName":"{{Escape(Environment.UserName)}}",
            "osVersion":"{{Escape(Environment.OSVersion.VersionString)}}",
            "platform":"{{Escape(RuntimeInformation.OSDescription)}}",
            "arch":"{{RuntimeInformation.OSArchitecture}}",
            "processArch":"{{RuntimeInformation.ProcessArchitecture}}",
            "processorCount":{{Environment.ProcessorCount}},
            "is64Bit":{{Environment.Is64BitOperatingSystem.ToString().ToLowerInvariant()}},
            "clrVersion":"{{Escape(Environment.Version.ToString())}}",
            "pid":{{Environment.ProcessId}},
            "tickCount":{{Environment.TickCount64}},
            "workingSet":{{Environment.WorkingSet}},
            "drives":[{{drivesJson}}]}
            """.Replace("\n", "").Replace("\r", "");
    }

    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
