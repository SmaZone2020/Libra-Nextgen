using System.Management;
using System.Security.Cryptography;
using System.Text;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Agent.Platform;

public static class HardwareCollector
{
    public static HardwareInfo Collect()
    {
        var info = new HardwareInfo();
        try { info.Cpu = CollectCpu(); } catch { }
        try { info.Gpus = CollectGpus(); } catch { }
        try { info.Disks = CollectDisks(); } catch { }
        try { info.Ram = CollectRam(); } catch { }
        try { info.Displays = CollectDisplays(); } catch { }
        try { info.MotherboardVendor = WmiSingle("Win32_BaseBoard", "Manufacturer"); } catch { }
        try { info.BiosVersion = WmiSingle("Win32_BIOS", "SMBIOSBIOSVersion"); } catch { }
        return info;
    }

    private static CpuInfo CollectCpu()
    {
        var name = WmiSingle("Win32_Processor", "Name") ?? "Unknown";
        var cores = int.TryParse(WmiSingle("Win32_Processor", "NumberOfCores"), out var c) ? c : 0;
        var threads = int.TryParse(WmiSingle("Win32_Processor", "ThreadCount"), out var t) ? t : 0;
        var maxClock = int.TryParse(WmiSingle("Win32_Processor", "MaxClockSpeed"), out var m) ? m : 0;
        return new CpuInfo { Name = name.Trim(), PhysicalCores = cores, LogicalCores = threads, MaxClockMHz = maxClock };
    }

    private static List<GpuInfo> CollectGpus()
    {
        var list = new List<GpuInfo>();
        using var searcher = new ManagementObjectSearcher("SELECT Name,DriverVersion,AdapterRAM FROM Win32_VideoController");
        foreach (var obj in searcher.Get())
        {
            var gpu = new GpuInfo
            {
                Name = obj["Name"]?.ToString() ?? "",
                DriverVersion = obj["DriverVersion"]?.ToString(),
                VramBytes = TryToInt64(obj["AdapterRAM"])
            };
            list.Add(gpu);
        }
        return list;
    }

    private static List<DiskInfo> CollectDisks()
    {
        var list = new List<DiskInfo>();
        using var searcher = new ManagementObjectSearcher("SELECT Model,Size,MediaType,SerialNumber FROM Win32_DiskDrive");
        foreach (var obj in searcher.Get())
        {
            var disk = new DiskInfo
            {
                Model = (obj["Model"]?.ToString() ?? "").Trim(),
                SizeBytes = TryToInt64(obj["Size"]) ?? 0,
                MediaType = obj["MediaType"]?.ToString(),
                SerialNumber = obj["SerialNumber"]?.ToString()?.Trim()
            };
            list.Add(disk);
        }
        return list;
    }

    private static RamInfo CollectRam()
    {
        var total = WmiSingle("Win32_ComputerSystem", "TotalPhysicalMemory");
        if (long.TryParse(total, out var b)) return new RamInfo { TotalBytes = b };
        return new RamInfo { TotalBytes = 0 };
    }

    private static List<DisplayInfo> CollectDisplays()
    {
        var list = new List<DisplayInfo>();
        using var searcher = new ManagementObjectSearcher("SELECT Name,ScreenWidth,ScreenHeight FROM Win32_DesktopMonitor");
        foreach (var obj in searcher.Get())
        {
            var dp = new DisplayInfo
            {
                Name = obj["Name"]?.ToString() ?? "",
                Width = (obj["ScreenWidth"] as int?) ?? 0,
                Height = (obj["ScreenHeight"] as int?) ?? 0
            };
            list.Add(dp);
        }
        return list;
    }

    private static long? TryToInt64(object? value) => value switch
    {
        long l => l > 0 ? l : null,
        int i => i > 0 ? i : null,
        uint ui => ui > 0 ? ui : null,
        ulong ul => ul > 0 ? (long?)ul : null,
        float f => f > 0 ? (long)f : null,
        double d => d > 0 ? (long)d : null,
        string s => long.TryParse(s, out var n) && n > 0 ? n : null,
        _ => null
    };

    private static string? WmiSingle(string className, string property)
    {
        using var searcher = new ManagementObjectSearcher($"SELECT {property} FROM {className}");
        foreach (var obj in searcher.Get())
        {
            return obj[property]?.ToString();
        }
        return null;
    }

    public static string ComputeHwid(HardwareInfo info)
    {
        var sb = new StringBuilder();
        sb.Append(info.Cpu?.Name ?? "");
        sb.Append('|');
        sb.Append(info.Disks.FirstOrDefault()?.SerialNumber ?? "");
        sb.Append('|');
        sb.Append(info.MotherboardVendor ?? "");
        sb.Append('|');
        sb.Append(info.BiosVersion ?? "");
        sb.Append('|');
        sb.Append(info.Ram?.TotalBytes.ToString() ?? "");
        var raw = sb.ToString();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexStringLower(hash);
    }

    public static string Serialize(HardwareInfo info)
    {
        try
        {
            var parts = new List<string>();

            if (info.Hwid != null)
                parts.Add($"\"hwid\":\"{Esc(info.Hwid)}\"");
            if (info.Cpu != null)
                parts.Add($"\"cpu\":{{\"name\":\"{Esc(info.Cpu.Name)}\",\"physicalCores\":{info.Cpu.PhysicalCores},\"logicalCores\":{info.Cpu.LogicalCores},\"maxClockMHz\":{info.Cpu.MaxClockMHz}}}");
            if (info.Gpus.Count > 0)
            {
                var gpuItems = info.Gpus.Select(g =>
                {
                    var gpuParts = $"\"name\":\"{Esc(g.Name)}\"";
                    if (g.DriverVersion != null)
                        gpuParts += $",\"driverVersion\":\"{Esc(g.DriverVersion)}\"";
                    if (g.VramBytes.HasValue)
                        gpuParts += $",\"vramBytes\":{g.VramBytes.Value}";
                    return $"{{{gpuParts}}}";
                });
                parts.Add($"\"gpus\":[{string.Join(",", gpuItems)}]");
            }
            if (info.Disks.Count > 0)
            {
                var diskItems = info.Disks.Select(d =>
                {
                    var diskParts = $"\"model\":\"{Esc(d.Model)}\",\"sizeBytes\":{d.SizeBytes}";
                    if (d.MediaType != null)
                        diskParts += $",\"mediaType\":\"{Esc(d.MediaType)}\"";
                    if (d.SerialNumber != null)
                        diskParts += $",\"serialNumber\":\"{Esc(d.SerialNumber)}\"";
                    return $"{{{diskParts}}}";
                });
                parts.Add($"\"disks\":[{string.Join(",", diskItems)}]");
            }
            if (info.Ram != null)
                parts.Add($"\"ram\":{{\"totalBytes\":{info.Ram.TotalBytes}}}");
            if (info.Displays.Count > 0)
            {
                var displayItems = info.Displays.Select(d =>
                    $"{{\"name\":\"{Esc(d.Name)}\",\"width\":{d.Width},\"height\":{d.Height}}}");
                parts.Add($"\"displays\":[{string.Join(",", displayItems)}]");
            }
            if (info.MotherboardVendor != null)
                parts.Add($"\"motherboardVendor\":\"{Esc(info.MotherboardVendor)}\"");
            if (info.BiosVersion != null)
                parts.Add($"\"biosVersion\":\"{Esc(info.BiosVersion)}\"");

            return $"{{{string.Join(",", parts)}}}";
        }
        catch { return "{}"; }
    }

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
