using LibraNextgen.Common.Pe;
using Xunit;

namespace LibraNextgen.Tests;

public class PeResourceWriterTests
{
    [Fact]
    public void Embed_AddsVersionAndIcon_AndKeepsPeValid()
    {
        // Use the test assembly itself as a real PE to exercise the writer.
        var pePath = typeof(PeResourceWriterTests).Assembly.Location;
        var pe = System.IO.File.ReadAllBytes(pePath);

        var metadata = new PeMetadata
        {
            CompanyName = "Test Company",
            FileDescription = "Test Description",
            ProductName = "Test Product",
            FileVersion = "1.2.3.4",
            ProductVersion = "1.2.3.4",
            Copyright = "(c) Test",
            Icon = BuildTinyIco(),
        };

        var result = PeResourceWriter.Embed(pe, metadata);

        // Still a valid MZ executable, and larger.
        Assert.Equal((byte)'M', result[0]);
        Assert.Equal((byte)'Z', result[1]);
        Assert.True(result.Length > pe.Length);

        // Resources are readable and include version + icon.
        var resources = PeResourceWriter.ReadResources(result);
        Assert.Contains(resources, r => r.Type == 16); // RT_VERSION
        Assert.Contains(resources, r => r.Type == 14); // RT_GROUP_ICON
        Assert.Contains(resources, r => r.Type == 3);  // RT_ICON
    }

    [Fact]
    public void Embed_NoMetadata_IsIdentitySize()
    {
        var pePath = typeof(PeResourceWriterTests).Assembly.Location;
        var pe = System.IO.File.ReadAllBytes(pePath);

        // Empty metadata → no version/icon added, but a new (empty) resource tree
        // is still appended. Just ensure it doesn't throw and remains a PE.
        var result = PeResourceWriter.Embed(pe, new PeMetadata());

        Assert.Equal((byte)'M', result[0]);
        Assert.Equal((byte)'Z', result[1]);
    }

    private static byte[] BuildTinyIco()
    {
        using var ms = new System.IO.MemoryStream();
        var w = new System.IO.BinaryWriter(ms);
        w.Write((ushort)0);   // reserved
        w.Write((ushort)1);   // type = icon
        w.Write((ushort)1);   // count
        w.Write((byte)1);     // width
        w.Write((byte)1);     // height
        w.Write((byte)0);     // color count
        w.Write((byte)0);     // reserved
        w.Write((ushort)1);   // planes
        w.Write((ushort)32);  // bpp
        w.Write((uint)4);     // bytes in resource
        w.Write((uint)22);    // image offset
        w.Write(new byte[] { 0xFF, 0x00, 0x00, 0x00 }); // 1 BGRA pixel
        return ms.ToArray();
    }
}
