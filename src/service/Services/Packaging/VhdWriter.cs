using System.Security.Cryptography;

namespace LibraNextgen.Service.Services.Packaging;

/// <summary>
/// 固定 VHD 磁盘镜像写入器 —— 纯托管实现，无外部依赖。
/// 结构：原始磁盘数据（FAT16 镜像）+ 512 字节 VHD footer（"conectix"）。
/// Windows 8+ 原生双击挂载 VHD；Linux qemu-nbd / loop 亦可访问。
/// </summary>
public static class VhdWriter
{
    private const ulong SectorSize = 512;

    /// <summary>将原始磁盘镜像（扇区大小 512，总字节数为 512 的倍数）包裹为固定 VHD。</summary>
    public static byte[] Create(byte[] rawDisk, string? uuid = null)
    {
        var diskSize = (ulong)rawDisk.Length;
        if (diskSize % SectorSize != 0)
            throw new ArgumentException("raw disk size must be a multiple of 512", nameof(rawDisk));

        var totalSectors = diskSize / SectorSize;
        var (cylinders, heads, sectorsPerTrack) = ComputeGeometry(totalSectors);

        var footer = new byte[SectorSize];
        // Offset 0: cookie "conectix"
        "conectix"u8.CopyTo(footer.AsSpan(0, 8));
        // Offset 8: features（fixed：0x00000002）
        WriteU32(footer, 8, 0x00000002);
        // Offset 12: file format version（1.0 = 0x00010000）
        WriteU32(footer, 12, 0x00010000);
        // Offset 16: data offset（fixed = 0xFFFFFFFFFFFFFFFF）
        WriteU64(footer, 16, 0xFFFFFFFFFFFFFFFF);
        // Offset 24: timestamp（秒，2000-01-01 起）
        var timestamp = (uint)(DateTime.UtcNow - new DateTime(2000, 1, 1)).TotalSeconds;
        WriteU32(footer, 24, timestamp);
        // Offset 28: creator application "lib"
        "lib"u8.CopyTo(footer.AsSpan(28, 3));
        // Offset 31: creator version
        WriteU32(footer, 31, 0x00010000);
        // Offset 35: creator host OS "wi2"（Windows 主机标识）
        "wi2"u8.CopyTo(footer.AsSpan(35, 3));
        // Offset 38: original size
        WriteU64(footer, 38, diskSize);
        // Offset 46: current size
        WriteU64(footer, 46, diskSize);
        // Offset 54: disk geometry（2+2+2 字节）
        footer[54] = (byte)(cylinders >> 8);
        footer[55] = (byte)(cylinders & 0xFF);
        footer[56] = (byte)heads;
        footer[57] = (byte)sectorsPerTrack;
        // Offset 58: disk type（2 = fixed）
        WriteU32(footer, 58, 2);
        // Offset 62: checksum（全部字段取反和，含自身置 0）
        WriteU32(footer, 62, 0);
        footer[66] = 0; // 保留
        // Offset 68: unique id（16 字节）
        var guid = uuid != null && Guid.TryParse(uuid, out var g) ? g : Guid.NewGuid();
        guid.TryWriteBytes(footer.AsSpan(68, 16));
        // Offset 84: saved state
        footer[84] = 0;

        var checksum = ComputeChecksum(footer);
        WriteU32(footer, 62, checksum);

        var vhd = new byte[rawDisk.Length + (int)SectorSize];
        Array.Copy(rawDisk, 0, vhd, 0, rawDisk.Length);
        Array.Copy(footer, 0, vhd, rawDisk.Length, (int)SectorSize);
        return vhd;
    }

    /// <summary>VHD CHS 几何：总扇区数 → (柱面, 磁头, 每磁道扇区)。</summary>
    private static (int Cylinders, int Heads, int SectorsPerTrack) ComputeGeometry(ulong totalSectors)
    {
        const ulong maxCylinders = 65535;
        const ulong maxHeads = 16;
        const ulong maxSectorsPerTrack = 255;

        // 优先：C ≤ 65535, H=16, S=255；超出则按 VHD 规范公式放大
        var sectorsPerTrack = maxSectorsPerTrack;
        var heads = maxHeads;
        var cylinders = totalSectors / (heads * sectorsPerTrack);
        if (cylinders <= maxCylinders)
            return ((int)cylinders, (int)heads, (int)sectorsPerTrack);

        // 大磁盘：C=65535, S=255, 计算 H
        cylinders = maxCylinders;
        heads = totalSectors / (cylinders * sectorsPerTrack);
        if (heads > maxHeads)
        {
            heads = maxHeads;
            sectorsPerTrack = totalSectors / (cylinders * heads);
        }
        return ((int)cylinders, (int)heads, (int)sectorsPerTrack);
    }

    private static uint ComputeChecksum(byte[] footer)
    {
        // ones' complement 校验和：所有字节（checksum 字段本身视为 0）求和取反
        var sum = 0U;
        for (var i = 0; i < footer.Length; i++)
        {
            if (i >= 62 && i < 66) continue; // checksum 字段
            sum = (sum + footer[i]) & 0xFFFFFFFF;
        }
        return ~sum;
    }

    private static void WriteU32(byte[] buf, int offset, uint value)
    {
        buf[offset] = (byte)((value >> 24) & 0xFF);
        buf[offset + 1] = (byte)((value >> 16) & 0xFF);
        buf[offset + 2] = (byte)((value >> 8) & 0xFF);
        buf[offset + 3] = (byte)(value & 0xFF);
    }

    private static void WriteU64(byte[] buf, int offset, ulong value)
    {
        WriteU32(buf, offset, (uint)(value >> 32));
        WriteU32(buf, offset + 4, (uint)(value & 0xFFFFFFFF));
    }
}
