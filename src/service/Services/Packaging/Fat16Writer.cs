using System.Text;

namespace LibraNextgen.Service.Services.Packaging;

/// <summary>
/// FAT16 原始磁盘镜像写入器 —— 纯托管实现，无外部依赖。
/// 结构：Boot Sector(1) + FAT ×2 + Root Directory(1..n) + Data Area（簇）。
/// 文件连续写入（簇链 2→3→…→last），根目录固定 16 项（2 个文件绰绰有余）。
/// 若载荷过小导致簇数 &lt; 4085（FAT12 下限），自动填充数据区保证 FAT16 合法性。
/// </summary>
public static class Fat16Writer
{
    private const int BytesPerSector = 512;
    private const int SectorsPerFat16Min = 1;

    /// <summary>创建 FAT16 镜像。文件名自动转 8.3 大写（如 setup.exe → SETUP.EXE）。</summary>
    public static byte[] Create(IReadOnlyList<(string Name, byte[] Data)> files)
    {
        // 1) 8.3 规范化文件名
        var normalized = files
            .Select(f => (Name: To83(f.Name), Data: f.Data))
            .ToList();

        // 2) 根目录：16 项 × 32 字节 = 1 扇区
        const int rootEntries = 16;
        var rootSectors = (rootEntries * 32 + BytesPerSector - 1) / BytesPerSector;

        // 3) 数据扇区（含最小簇数填充）
        var payloadSectors = normalized.Sum(f => (f.Data.Length + BytesPerSector - 1) / BytesPerSector);

        // 4) 选择每簇扇区数：簇数落在 [4085, 65524]（FAT16 合法区间）
        var (spc, fatSectors, dataSectors, totalSectors) = ComputeGeometry(payloadSectors, rootSectors);
        var clusters = dataSectors / spc;

        // 5) 组装镜像
        var image = new byte[totalSectors * BytesPerSector];
        WriteBootSector(image, spc, (ushort)fatSectors, (ushort)rootEntries, (ushort)totalSectors, clusters, normalized.Count);

        // 6) FAT ×2：FAT[0]=0xFFF8, FAT[1]=0xFFFF，文件簇链
        var fat = new byte[fatSectors * BytesPerSector];
        WriteFat(fat, spc, normalized);
        Array.Copy(fat, 0, image, BytesPerSector, fat.Length);
        Array.Copy(fat, 0, image, BytesPerSector + fat.Length, fat.Length);

        // 7) 根目录条目 + 文件数据
        var rootOffset = BytesPerSector + fat.Length * 2;
        var root = new byte[rootSectors * BytesPerSector];
        var dataStart = rootOffset + root.Length;
        int clusterCursor = 2;
        for (var i = 0; i < normalized.Count; i++)
        {
            var (name, data) = normalized[i];
            var clustersNeeded = (data.Length + spc * BytesPerSector - 1) / (spc * BytesPerSector);
            WriteRootEntry(root, i * 32, name, clusterCursor, data.Length);
            var dataOffset = dataStart + (long)(clusterCursor - 2) * spc * BytesPerSector;
            Array.Copy(data, 0, image, dataOffset, data.Length);
            clusterCursor += clustersNeeded;
        }
        Array.Copy(root, 0, image, rootOffset, root.Length);

        return image;
    }

    /// <summary>
    /// 计算 FAT16 几何参数（不动点迭代：FAT 扇区数依赖簇数，簇数依赖数据扇区数）。
    /// 簇数下限不足 4085 时填充数据区（保持 FAT16 而非降级 FAT12）。
    /// </summary>
    private static (int Spc, int FatSectors, int DataSectors, int TotalSectors) ComputeGeometry(int payloadSectors, int rootSectors)
    {
        const int reserved = 1;
        const int fats = 2;
        const int minClusters = 4085;

        int[] spcCandidates = [1, 2, 4, 8, 16, 32, 64, 128, 256];

        foreach (var spc in spcCandidates)
        {
            var fatSectors = SectorsPerFat16Min;
            for (var iter = 0; iter < 16; iter++)
            {
                var totalSectors = reserved + fats * fatSectors + rootSectors + payloadSectors;
                var dataSectors = totalSectors - reserved - fats * fatSectors - rootSectors;
                var clusters = dataSectors / spc;
                if (clusters < minClusters)
                {
                    // 填充数据区到最小簇数
                    dataSectors = minClusters * spc;
                    totalSectors = reserved + fats * fatSectors + rootSectors + dataSectors;
                    clusters = minClusters;
                }
                var newFatSectors = ((clusters * 2) + BytesPerSector - 1) / BytesPerSector;
                if (newFatSectors == fatSectors)
                    return (spc, fatSectors, dataSectors, totalSectors);
                fatSectors = newFatSectors;
            }
        }
        // 256 簇/扇区仍超限（>2GB 镜像）——理论上不会发生，防御兜底
        throw new InvalidOperationException("payload too large for FAT16 image");
    }

    private static void WriteBootSector(byte[] image, int spc, ushort fatSectors, ushort rootEntries, ushort totalSectors16, int clusters, int fileCount)
    {
        var boot = new byte[BytesPerSector];
        boot[0] = 0xEB; boot[1] = 0x3C; boot[2] = 0x90;             // jump
        "LIBRA-IMG"u8.CopyTo(boot.AsSpan(3, 9));                    // OEM name
        WriteU16(boot, 11, BytesPerSector);                         // BytesPerSector
        boot[13] = (byte)spc;                                       // SectorsPerCluster
        WriteU16(boot, 14, 1);                                      // ReservedSectors
        boot[16] = 2;                                               // NumberOfFATs
        WriteU16(boot, 17, rootEntries);                            // RootEntryCount
        WriteU16(boot, 19, totalSectors16);                         // TotalSectors16
        boot[21] = 0xF8;                                            // MediaDescriptor
        WriteU16(boot, 22, fatSectors);                             // SectorsPerFAT
        WriteU16(boot, 24, 32);                                     // SectorsPerTrack
        WriteU16(boot, 26, 64);                                     // NumberOfHeads
        WriteU32(boot, 28, 0);                                      // HiddenSectors
        WriteU32(boot, 32, 0);                                      // TotalSectors32
        boot[36] = 0x80;                                            // DriveNumber
        boot[38] = 0x29;                                            // ExtendedBootSignature
        var serial = (uint)Random.Shared.NextInt64(0x10000000, 0x7FFFFFFF);
        WriteU32(boot, 39, serial);                                 // VolumeSerialNumber
        "LIBRA-IMG  "u8.CopyTo(boot.AsSpan(43, 11));                // VolumeLabel（9 字符 + 2 空格 = 11）
        "FAT16   "u8.CopyTo(boot.AsSpan(54, 8));                    // FileSystemType
        boot[510] = 0x55; boot[511] = 0xAA;                         // Boot signature
        Array.Copy(boot, 0, image, 0, BytesPerSector);
    }

    private static void WriteFat(byte[] fat, int spc, IReadOnlyList<(string Name, byte[] Data)> files)
    {
        WriteU16(fat, 0, 0xFFF8);   // media descriptor
        WriteU16(fat, 2, 0xFFFF);   // reserved

        var clusterCursor = 2;
        foreach (var (_, data) in files)
        {
            var clustersNeeded = (data.Length + spc * BytesPerSector - 1) / (spc * BytesPerSector);
            var last = clusterCursor + clustersNeeded - 1;
            for (var i = clusterCursor; i < last; i++)
                WriteU16(fat, i * 2, (ushort)(i + 1));
            WriteU16(fat, last * 2, 0xFFFF); // EOF
            clusterCursor += clustersNeeded;
        }
        // 其余空闲簇置 0（镜像初始化时已清零）
    }

    private static void WriteRootEntry(byte[] root, int offset, string name83, int firstCluster, int fileSize)
    {
        var name = name83.ToUpperInvariant();
        var (baseName, ext) = Split83(name);
        Encoding.ASCII.GetBytes(baseName.PadRight(8, ' ')).CopyTo(root, offset);
        Encoding.ASCII.GetBytes(ext.PadRight(3, ' ')).CopyTo(root, offset + 8);
        root[offset + 11] = 0x20; // archive attribute
        var dt = DateTime.UtcNow;
        // FAT16 目录项布局：14-17 创建时间/日期、18-19 最近访问日期、
        // 20-21 首簇高字(=0)、22-25 写入时间/日期、26-27 首簇低字、28-31 文件大小
        WriteU16(root, offset + 14, EncodeTime(dt));
        WriteU16(root, offset + 16, EncodeDate(dt));
        WriteU16(root, offset + 18, EncodeDate(dt));
        WriteU16(root, offset + 20, 0);       // 首簇高 16 位（FAT16 = 0）
        WriteU16(root, offset + 22, EncodeTime(dt));
        WriteU16(root, offset + 24, EncodeDate(dt));
        WriteU16(root, offset + 26, (ushort)firstCluster);
        WriteU32(root, offset + 28, (uint)fileSize);
    }

    private static (string Base, string Ext) Split83(string name83) =>
        name83.Contains('.') ? (name83[..name83.IndexOf('.')], name83[(name83.IndexOf('.') + 1)..]) : (name83, "");

    private static string To83(string name)
    {
        var upper = Path.GetFileName(name).ToUpperInvariant();
        var dot = upper.LastIndexOf('.');
        var baseName = dot >= 0 ? upper[..dot] : upper;
        var ext = dot >= 0 ? upper[(dot + 1)..] : "";
        if (baseName.Length > 8) baseName = baseName[..8];
        if (ext.Length > 3) ext = ext[..3];
        return ext.Length > 0 ? $"{baseName}.{ext}" : baseName;
    }

    private static ushort EncodeTime(DateTime dt) =>
        (ushort)((dt.Hour << 11) | (dt.Minute << 5) | (dt.Second / 2));

    private static ushort EncodeDate(DateTime dt) =>
        (ushort)(((dt.Year - 1980) << 9) | (dt.Month << 5) | dt.Day);

    private static void WriteU16(byte[] buf, int offset, ushort value)
    {
        buf[offset] = (byte)(value & 0xFF);
        buf[offset + 1] = (byte)(value >> 8);
    }

    private static void WriteU32(byte[] buf, int offset, uint value)
    {
        buf[offset] = (byte)(value & 0xFF);
        buf[offset + 1] = (byte)((value >> 8) & 0xFF);
        buf[offset + 2] = (byte)((value >> 16) & 0xFF);
        buf[offset + 3] = (byte)((value >> 24) & 0xFF);
    }
}
