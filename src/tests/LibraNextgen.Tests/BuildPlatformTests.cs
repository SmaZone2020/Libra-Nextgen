using LibraNextgen.Service.Models;
using LibraNextgen.Service.Services.Builder;
using Xunit;

namespace LibraNextgen.Tests;

public class BuildPlatformTests
{
    [Theory]
    [InlineData("x64", "windows", "x64")]
    [InlineData("x86", "windows", "x86")]
    [InlineData("win-arm64", "windows", "arm64")]
    [InlineData("linux-x64", "linux", "x64")]
    [InlineData("linux-arm64", "linux", "arm64")]
    [InlineData("mac-arm64", "macos", "arm64")]
    public void Specs_CoverAllPlatforms(string platform, string expectedOs, string expectedArch)
    {
        Assert.True(BuilderBuildService.PlatformOs.TryGetValue(platform, out var actualOs));
        Assert.Equal(expectedOs, actualOs);
        Assert.Equal(expectedOs, BuilderBuildService.OsOf(platform));
        Assert.Equal(expectedArch, BuilderBuildService.ArchOf(platform));
        Assert.Contains(platform, BuildPlatforms.All);
    }

    [Theory]
    [InlineData("x64", true, "x86_64-pc-windows-msvc")]
    [InlineData("x64", false, "x86_64-pc-windows-gnu")]
    [InlineData("x86", true, "i686-pc-windows-msvc")]
    [InlineData("x86", false, "i686-pc-windows-gnu")]
    [InlineData("win-arm64", true, "aarch64-pc-windows-msvc")]
    [InlineData("win-arm64", false, "aarch64-pc-windows-gnu")]
    [InlineData("linux-x64", true, "x86_64-unknown-linux-gnu")]
    [InlineData("linux-x64", false, "x86_64-unknown-linux-gnu")]
    [InlineData("linux-arm64", true, "aarch64-unknown-linux-gnu")]
    [InlineData("linux-arm64", false, "aarch64-unknown-linux-gnu")]
    [InlineData("mac-arm64", true, "aarch64-apple-darwin")]
    [InlineData("mac-arm64", false, "aarch64-apple-darwin")]
    public void ResolveTriple_MatchesPlatformAndHost(string platform, bool hostWindows, string triple)
    {
        Assert.Equal(triple, BuilderBuildService.ResolveTriple(platform, hostWindows));
    }

    [Theory]
    [InlineData("x64", "dll")]
    [InlineData("x86", "dll")]
    [InlineData("win-arm64", "dll")]
    [InlineData("linux-x64", "so")]
    [InlineData("linux-arm64", "so")]
    [InlineData("mac-arm64", "dylib")]
    public void ModuleExt_MatchesOs(string platform, string ext)
    {
        Assert.Equal(ext, BuilderBuildService.ModuleExt(platform));
    }

    [Theory]
    [InlineData("Windows 11 Pro 23H2", "aarch64", "win-arm64")]
    [InlineData("Windows 11", "x86_64", "x64")]
    [InlineData("Windows 10", "i686", "x86")]
    [InlineData("Debian GNU/Linux 12 (bookworm)", "x86_64", "linux-x64")]
    [InlineData("Debian GNU/Linux 12 (bookworm)", "aarch64", "linux-arm64")]
    [InlineData("macos aarch64", "aarch64", "mac-arm64")]
    [InlineData("macOS 14.5", "arm64", "mac-arm64")]
    public void MapOsArch_ResolvesPlatform(string osVersion, string arch, string platform)
    {
        Assert.Equal(platform, BuildPlatforms.MapOsArch(osVersion, arch));
    }

    [Theory]
    [InlineData("Ubuntu 22.04.3 LTS", "x86_64")] // os-release without the word "Linux"
    [InlineData("", "")]
    [InlineData("unknown", "unknown")]
    public void MapOsArch_Unrecognized_ReturnsNull(string osVersion, string arch)
    {
        Assert.Null(BuildPlatforms.MapOsArch(osVersion, arch));
    }

    [Fact]
    public void Feasibility_RejectsMacArm64OffMac()
    {
        if (OperatingSystem.IsMacOS())
            return; // Cannot simulate a non-macOS host while running on macOS.
        Assert.NotNull(BuilderBuildService.FeasibilityError("mac-arm64"));
        Assert.Null(BuilderBuildService.FeasibilityError("x64"));
        Assert.Null(BuilderBuildService.FeasibilityError("linux-arm64"));
    }
}
