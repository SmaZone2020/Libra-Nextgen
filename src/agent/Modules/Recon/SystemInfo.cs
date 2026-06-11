using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace LibraNextgen.Agent.Modules.Recon;

public static class SystemInfo
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct RTL_OSVERSIONINFOEXW
    {
        public uint dwOSVersionInfoSize;
        public uint dwMajorVersion;
        public uint dwMinorVersion;
        public uint dwBuildNumber;
        public uint dwPlatformId;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szCSDVersion;
    }

    [DllImport("ntdll.dll", SetLastError = true)]
    private static extern int RtlGetVersion(ref RTL_OSVERSIONINFOEXW versionInfo);

    public static string Collect()
    {
        var osVersion = GetOsVersion();
        var drives = DriveInfo.GetDrives()
            .Where(d => d.IsReady)
            .Select(d => $"{{\"name\":\"{Escape(d.Name)}\",\"format\":\"{d.DriveFormat}\",\"totalGb\":{d.TotalSize / (1024.0 * 1024 * 1024):F1},\"freeGb\":{d.AvailableFreeSpace / (1024.0 * 1024 * 1024):F1}}}");
        var drivesJson = string.Join(",", drives);

        return $$"""
            {"hostname":"{{Escape(Environment.MachineName)}}",
            "userName":"{{Escape(Environment.UserName)}}",
            "osVersion":"{{Escape(osVersion)}}",
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

    public static string GetOsVersion()
    {
        if (!OperatingSystem.IsWindows())
            return Environment.OSVersion.VersionString;

        try
        {
            var v = new RTL_OSVERSIONINFOEXW();
            v.dwOSVersionInfoSize = (uint)Marshal.SizeOf(v);

            if (RtlGetVersion(ref v) != 0)
                return Environment.OSVersion.VersionString;

            var versionName = v.dwMajorVersion switch
            {
                10 when v.dwBuildNumber >= 22000 => "Windows 11",
                10 => "Windows 10",
                6 when v.dwMinorVersion == 3 => "Windows 8.1",
                6 when v.dwMinorVersion == 2 => "Windows 8",
                6 when v.dwMinorVersion == 1 => "Windows 7",
                _ => $"Windows {v.dwMajorVersion}.{v.dwMinorVersion}"
            };

            var displayVersion = Registry.GetValue(
                @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion",
                "DisplayVersion", "")?.ToString() ?? "";

            var productName = Registry.GetValue(
                @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion",
                "ProductName", "")?.ToString() ?? "";

            // ProductName format: "Windows 10 Pro" / "Windows 11 Enterprise"
            // Extract edition suffix
            var parts = productName.Split(' ');
            var edition = parts.Length >= 3 ? string.Join(" ", parts[2..]) : "";

            if (!string.IsNullOrEmpty(edition))
                return $"{versionName} {edition} {displayVersion}".Trim();
            return $"{versionName} {displayVersion}".Trim();
        }
        catch
        {
            return Environment.OSVersion.VersionString;
        }
    }

    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
