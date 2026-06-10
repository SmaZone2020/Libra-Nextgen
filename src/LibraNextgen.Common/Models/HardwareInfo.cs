namespace LibraNextgen.Common.Models;

public class HardwareInfo
{
    public string? Hwid { get; set; }
    public CpuInfo? Cpu { get; set; }
    public List<GpuInfo> Gpus { get; set; } = new();
    public List<DiskInfo> Disks { get; set; } = new();
    public RamInfo? Ram { get; set; }
    public List<DisplayInfo> Displays { get; set; } = new();
    public string? MotherboardVendor { get; set; }
    public string? BiosVersion { get; set; }
}

public class CpuInfo
{
    public string Name { get; set; } = string.Empty;
    public int PhysicalCores { get; set; }
    public int LogicalCores { get; set; }
    public int MaxClockMHz { get; set; }
}

public class GpuInfo
{
    public string Name { get; set; } = string.Empty;
    public string? DriverVersion { get; set; }
    public long? VramBytes { get; set; }
}

public class DiskInfo
{
    public string Model { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public string? MediaType { get; set; }
    public string? SerialNumber { get; set; }
}

public class RamInfo
{
    public long TotalBytes { get; set; }
}

public class DisplayInfo
{
    public string Name { get; set; } = string.Empty;
    public int Width { get; set; }
    public int Height { get; set; }
}
