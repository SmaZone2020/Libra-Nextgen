using System.Text;

namespace LibraNextgen.Service.Services.Packaging;

/// <summary>
/// 极简 ISO9660（Level 1，8.3 大写文件名）镜像写入器 —— 纯托管实现，无外部依赖。
/// 布局：System Area(16 扇区) + PVD(1) + Terminator(1) + Path Table L/M(各 1)
///      + 根目录(1..n) + 文件数据（每文件 2048 对齐）。
/// 兼容 Windows 资源管理器 / Linux mount -o loop / macOS hdiutil。
/// </summary>
public static class Iso9660Writer
{
    private const int SectorSize = 2048;
    private const int SystemAreaSectors = 16; // 32 KB

    public static byte[] Create(string volumeLabel, IReadOnlyList<(string Name, byte[] Data)> files)
    {
        // 1) 文件数据按顺序排布，每文件对齐 2048
        var fileLayout = new List<(string Name, int Offset, int Size)>();
        var data = new List<byte>();
        foreach (var (name, bytes) in files)
        {
            while (data.Count % SectorSize != 0) data.Add(0);
            fileLayout.Add((name, data.Count, bytes.Length));
            data.AddRange(bytes);
        }
        while (data.Count % SectorSize != 0) data.Add(0); // 尾部对齐
        var fileSectors = data.Count / SectorSize;

        // 2) 根目录记录（根目录 = 目录记录列表 + 终止记录，对齐 2048）。
        //    文件 extent 依赖 filesLba（下方布局后回填），先写 0 占位。
        var rootDir = new List<byte>();
        var recordOffsets = new List<int>(); // 每条记录在 rootDir 中的起始偏移（用于回填 extent）
        foreach (var (name, offset, size) in fileLayout)
        {
            recordOffsets.Add(rootDir.Count);
            rootDir.AddRange(BuildFileRecord(0, (uint)size, name, flags: 0x00));
        }
        rootDir.AddRange(new byte[] { 0, 0 }); // 终止记录
        while (rootDir.Count % SectorSize != 0) rootDir.Add(0);
        var rootDirSectors = rootDir.Count / SectorSize;

        // 3) LBA 布局（先于 Path Table：其 extent 依赖 rootDirLba）
        int pvdLba = SystemAreaSectors;
        int terminatorLba = pvdLba + 1;
        int ptLba = terminatorLba + 1;       // L 表
        int ptMLba = ptLba + 1;              // M 表
        int rootDirLba = ptMLba + 1;
        int filesLba = rootDirLba + rootDirSectors;

        // 3.5) Path Table：根目录单记录（10 字节），L/M 两种字节序（extent 依赖 rootDirLba）
        var ptL = BuildPathTable((uint)rootDirLba, littleEndian: true);
        var ptM = BuildPathTable((uint)rootDirLba, littleEndian: false);

        var totalSectors = filesLba + fileSectors;
        var iso = new byte[totalSectors * SectorSize];

        // 5) PVD
        var pvd = new byte[SectorSize];
        pvd[0] = 1;
        "CD001"u8.CopyTo(pvd.AsSpan(1, 5));
        pvd[6] = 1;
        WriteAChars(pvd, 8, 32, "");                              // System Identifier (8-39)
        WriteAChars(pvd, 40, 32, volumeLabel);                    // Volume Identifier (40-71)
        // 72-79 unused
        WriteBothEndian(pvd, 80, (uint)totalSectors);             // Volume Space Size (80-87, LE32+BE32)
        // 88-119 unused（ECMA-119 8.4.6：Volume Set Size 等在 120+）
        WriteBothEndian16(pvd, 120, 1);                           // Volume Set Size (120-123, LE16+BE16)
        WriteBothEndian16(pvd, 124, 1);                           // Volume Sequence Number (124-127)
        WriteBothEndian16(pvd, 128, (ushort)SectorSize);          // Logical Block Size (128-131, LE16+BE16)
        WriteBothEndian(pvd, 132, (uint)ptL.Length);              // Path Table Size (132-139, LE32+BE32)
        // 140: Type L Path Table Location（仅 LE32）
        WriteLittleEndian(pvd, 140, (uint)ptLba);
        // 144: Optional Type L（0）
        // 148: Type M Path Table Location（仅 BE32）
        WriteBigEndian(pvd, 148, (uint)ptMLba);
        // 152: Optional Type M（0）
        // 156: Root Directory Record（34 字节）
        var rootRecord = BuildFileRecord((uint)rootDirLba, (uint)rootDir.Count, "\0", flags: 0x02);
        Array.Copy(rootRecord, 0, pvd, 156, rootRecord.Length);   // Root Directory Record
        // 190: Volume Set Identifier（128）；318: Publisher（128）；446: Data Preparer（128）；574: Application（128）
        WriteAChars(pvd, 190, 128, "LIBRA-NEXTGEN");
        WriteAChars(pvd, 318, 128, "LIBRA-NEXTGEN");
        WriteAChars(pvd, 446, 128, "LIBRA-NEXTGEN");
        WriteAChars(pvd, 574, 128, "LIBRA-NEXTGEN");
        // 702: Copyright（37）；739: Abstract（37）；776: Bibliographic（37）
        WriteAChars(pvd, 702, 37, " ");
        WriteAChars(pvd, 739, 37, " ");
        WriteAChars(pvd, 776, 37, " ");
        // 813: Creation（17）；830: Modification（17）；847: Expiration（17）；864: Effective（17）
        WriteAChars(pvd, 813, 17, NowStamp());
        WriteAChars(pvd, 830, 17, NowStamp());
        WriteAChars(pvd, 847, 17, "                ");            // 空格 = 永不过期
        WriteAChars(pvd, 864, 17, "                ");
        pvd[881] = 1;                                             // File Structure Version (881)
        Array.Copy(pvd, 0, iso, pvdLba * SectorSize, SectorSize);

        // 6) Terminator
        var terminator = new byte[SectorSize];
        terminator[0] = 255;
        "CD001"u8.CopyTo(terminator.AsSpan(1, 5));
        terminator[6] = 1;
        Array.Copy(terminator, 0, iso, terminatorLba * SectorSize, SectorSize);

        // 7) Path Tables
        Array.Copy(ptL, 0, iso, ptLba * SectorSize, ptL.Length);
        Array.Copy(ptM, 0, iso, ptMLba * SectorSize, ptM.Length);

        // 8) 根目录（回填文件 extent：数据区起点 + 文件内偏移）——写入根目录后回填，避免数组偏移错误
        rootDir.ToArray().CopyTo(iso, rootDirLba * SectorSize);
        for (var i = 0; i < fileLayout.Count; i++)
        {
            var recOff = rootDirLba * SectorSize + recordOffsets[i];
            var extent = (uint)(filesLba + fileLayout[i].Offset / SectorSize);
            WriteBothEndian(iso, recOff + 2, extent);
        }

        // 9) 文件数据（data 缓冲区即文件区整体）
        data.CopyTo(iso, filesLba * SectorSize);

        return iso;
    }

    /// <summary>目录记录（根目录标识符为单字节 0x00；8.3 文件名由调用方大写化）。</summary>
    private static byte[] BuildFileRecord(uint extentLba, uint dataLength, string name, byte flags)
    {
        var nameBytes = name == "\0" ? new byte[] { 0 } : Encoding.ASCII.GetBytes(name);
        // 根目录记录固定 34 字节（33 + 1 个标识符字节，偶数无需补齐）；
        // 普通文件名记录长度 = 33 + 名称 + 奇偶补齐。
        var len = name == "\0" ? 34 : 33 + nameBytes.Length + (nameBytes.Length % 2 == 0 ? 0 : 1);
        var rec = new byte[len];
        rec[0] = (byte)len;                    // Length of Directory Record
        rec[1] = 0;                            // Extended Attribute Record Length
        WriteBothEndian(rec, 2, extentLba);    // Extent Location
        WriteBothEndian(rec, 10, dataLength);  // Data Length
        var dt = DateTime.UtcNow;
        rec[18] = (byte)(dt.Year - 1900);      // Recording Date
        rec[19] = (byte)dt.Month;
        rec[20] = (byte)dt.Day;
        rec[21] = (byte)dt.Hour;
        rec[22] = (byte)dt.Minute;
        rec[23] = (byte)dt.Second;
        rec[24] = 0;                           // GMT offset (15-min units)
        rec[25] = flags;                       // File Flags
        rec[26] = 0;
        rec[27] = 0;
        WriteBothEndian16(rec, 28, 1);         // Volume Sequence Number
        rec[32] = (byte)nameBytes.Length;      // File Identifier Length
        Array.Copy(nameBytes, 0, rec, 33, nameBytes.Length);
        return rec;
    }

    /// <summary>Path Table：根目录单记录（10 字节：8 头 + 1 标识符 + 1 补齐）。</summary>
    private static byte[] BuildPathTable(uint rootDirLba, bool littleEndian)
    {
        var pt = new byte[10];
        pt[0] = 1;                             // 根目录标识符长度
        pt[1] = 0;                             // Extended Attribute Record Length
        if (littleEndian) WriteLittleEndian(pt, 2, rootDirLba);
        else WriteBigEndian(pt, 2, rootDirLba);
        pt[6] = 1;                             // Parent Directory Number（根 = 1）
        pt[7] = 0;                             // 根目录标识符（单字节 0）
        return pt;                             // [8] = 0 补齐
    }

    private static string NowStamp()
    {
        var dt = DateTime.UtcNow;
        return $"{dt.Year:0000}{dt.Month:00}{dt.Day:00}{dt.Hour:00}{dt.Minute:00}{dt.Second:00}00";
    }

    private static void WriteAChars(byte[] buf, int offset, int maxLen, string text)
    {
        var bytes = Encoding.ASCII.GetBytes(text);
        var n = Math.Min(bytes.Length, maxLen);
        Array.Copy(bytes, 0, buf, offset, n);
        for (var i = n; i < maxLen; i++) buf[offset + i] = (byte)' ';
    }

    private static void WriteLittleEndian(byte[] buf, int offset, uint value)
    {
        buf[offset] = (byte)(value & 0xFF);
        buf[offset + 1] = (byte)((value >> 8) & 0xFF);
        buf[offset + 2] = (byte)((value >> 16) & 0xFF);
        buf[offset + 3] = (byte)((value >> 24) & 0xFF);
    }

    private static void WriteBigEndian(byte[] buf, int offset, uint value)
    {
        buf[offset] = (byte)((value >> 24) & 0xFF);
        buf[offset + 1] = (byte)((value >> 16) & 0xFF);
        buf[offset + 2] = (byte)((value >> 8) & 0xFF);
        buf[offset + 3] = (byte)(value & 0xFF);
    }

    private static void WriteBothEndian(byte[] buf, int offset, uint value)
    {
        // 目录记录/根目录记录的双端字段：LE32 紧随 BE32（同 4 字节值两种字节序）
        WriteLittleEndian(buf, offset, value);
        WriteBigEndian(buf, offset + 4, value);
    }

    private static void WriteBothEndian16(byte[] buf, int offset, ushort value)
    {
        // 16 位双端字段：LE16 + BE16（Volume Set Size / Volume Sequence Number 等）
        buf[offset] = (byte)(value & 0xFF);
        buf[offset + 1] = (byte)(value >> 8);
        buf[offset + 2] = (byte)(value >> 8);
        buf[offset + 3] = (byte)(value & 0xFF);
    }
}
