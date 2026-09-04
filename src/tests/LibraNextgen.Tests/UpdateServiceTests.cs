using LibraNextgen.Service.Services.Platform;
using Xunit;

namespace LibraNextgen.Tests;

public class UpdateServiceTests
{
    [Theory]
    [InlineData("1.6.1", "1.6.0", 1)]
    [InlineData("v1.6.1", "1.6.1", 0)]
    [InlineData("1.6.0", "1.6.1", -1)]
    [InlineData("2.0.0", "1.9.9", 1)]
    [InlineData("1.6", "1.6.0", 0)]
    [InlineData("1.6.1-beta", "1.6.1", 0)] // prerelease suffix ignored
    public void CompareVersions_Works(string a, string b, int expected)
    {
        Assert.Equal(expected, System.Math.Sign(UpdateService.CompareVersions(a, b)));
    }

    [Theory]
    [InlineData("1.6.1", true, 1, 6, 1)]
    [InlineData("v1.2.3", true, 1, 2, 3)]
    [InlineData("1.2", true, 1, 2, 0)]
    [InlineData("", false, 0, 0, 0)]
    [InlineData("abc", false, 0, 0, 0)]
    public void TryParseVersion_Works(string tag, bool ok, int major, int minor, int patch)
    {
        var parsed = UpdateService.TryParseVersion(tag, out var v);
        Assert.Equal(ok, parsed);
        if (ok) Assert.Equal((major, minor, patch), v);
    }

    [Fact]
    public void ParseRelease_ReadsFieldsAndTruncatesNotes()
    {
        var notes = new string('x', 1200);
        var json =
            $$"""{"tag_name":"1.6.1","html_url":"https://github.com/o/r/releases/tag/1.6.1","published_at":"2026-09-03T00:00:00Z","body":"{{notes}}"}""";
        var info = UpdateService.ParseRelease(json);

        Assert.NotNull(info);
        Assert.Equal("1.6.1", info!.Tag);
        Assert.Equal("https://github.com/o/r/releases/tag/1.6.1", info.HtmlUrl);
        Assert.Equal(601, info.Notes!.Length); // 600 chars + ellipsis
        Assert.EndsWith("…", info.Notes);
    }

    [Fact]
    public void ParseRelease_InvalidJson_ReturnsNull()
    {
        Assert.Null(UpdateService.ParseRelease("not json"));
        Assert.Null(UpdateService.ParseRelease("{}"));
    }
}
