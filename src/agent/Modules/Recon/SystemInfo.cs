using System.Runtime.InteropServices;
using System.Text.Json;

namespace LibraNextgen.Agent.Modules.Recon;

public static class SystemInfo
{
    public static string Collect()
    {
        var info = new
        {
            hostname = Environment.MachineName,
            userName = Environment.UserName,
            osVersion = Environment.OSVersion.VersionString,
            platform = RuntimeInformation.OSDescription,
            arch = RuntimeInformation.OSArchitecture.ToString(),
            processArch = RuntimeInformation.ProcessArchitecture.ToString(),
            processorCount = Environment.ProcessorCount,
            is64Bit = Environment.Is64BitOperatingSystem,
            clrVersion = Environment.Version.ToString(),
            pid = Environment.ProcessId,
            tickCount = Environment.TickCount64,
            workingSet = Environment.WorkingSet,
            drives = DriveInfo.GetDrives()
                .Where(d => d.IsReady)
                .Select(d => new { name = d.Name, format = d.DriveFormat, totalGb = d.TotalSize / (1024.0 * 1024 * 1024), freeGb = d.AvailableFreeSpace / (1024.0 * 1024 * 1024) })
                .ToArray()
        };
        return JsonSerializer.Serialize(info);
    }
}
