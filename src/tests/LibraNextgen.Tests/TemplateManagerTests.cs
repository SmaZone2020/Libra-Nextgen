using System.IO.Compression;
using System.Text;
using LibraNextgen.Service.Models;
using LibraNextgen.Service.Services.Builder;
using Xunit;

namespace LibraNextgen.Tests;

public class TemplateManagerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "lng-tpl-" + Guid.NewGuid().ToString("N"));

    public TemplateManagerTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch { /* best effort */ }
    }

    private static void AddEntry(ZipArchive zip, string name, string content)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Fastest);
        using var sw = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        sw.Write(content);
    }

    /// <summary>Build a structurally valid template zip for a platform.</summary>
    private string BuildZip(string platform, bool includeLoader = true, string? manifestPlatform = null, bool includeManifest = true)
    {
        var (loader, desktop, core) = TemplateManagerService.PayloadNames(platform);
        var ext = BuilderBuildService.ModuleExt(platform);
        var path = Path.Combine(_root, $"tpl-{platform}.zip");
        using (var zip = ZipFile.Open(path, ZipArchiveMode.Create))
        {
            if (includeManifest)
                AddEntry(zip, "manifest.json",
                    $$"""{"platform":"{{manifestPlatform ?? platform}}","tag":"v1.2.3","commit":"deadbeef","built_at":"2026-09-03T00:00:00Z"}""");
            if (includeLoader) AddEntry(zip, loader, "loader payload");
            if (desktop != null) AddEntry(zip, desktop, "desktop loader payload");
            AddEntry(zip, core, "core payload");
            foreach (var (module, _) in BuilderBuildService.CloudModules)
                AddEntry(zip, $"{module}.{ext}", $"module {module}");
        }
        return path;
    }

    [Theory]
    [InlineData("x64", "loader.exe", "core.dll", "dll")]
    [InlineData("linux-x64", "loader", "libcore.so", "so")]
    [InlineData("linux-arm64", "loader", "libcore.so", "so")]
    [InlineData("mac-arm64", "loader", "libcore.dylib", "dylib")]
    public void InstallZip_ValidTemplate_SucceedsAndCaches(string platform, string loader, string core, string ext)
    {
        var cacheDir = Path.Combine(_root, "cache-" + platform);
        var install = TemplateManagerService.InstallZip(BuildZip(platform), platform, cacheDir, $"libra-agent-tpl-{platform}.zip", 1234, "v1.2.3");

        Assert.Equal("v1.2.3", install.Tag);
        Assert.Equal("deadbeef", install.Commit);
        Assert.Empty(install.MissingModules);
        Assert.True(File.Exists(Path.Combine(cacheDir, loader)));
        Assert.True(File.Exists(Path.Combine(cacheDir, core)));
        foreach (var (module, _) in BuilderBuildService.CloudModules)
            Assert.True(File.Exists(Path.Combine(cacheDir, $"{module}.{ext}")), $"missing {module}.{ext}");
        Assert.True(File.Exists(Path.Combine(cacheDir, "cache.json")));
    }

    [Fact]
    public void InstallZip_PlatformMismatch_Throws()
    {
        var zip = BuildZip("x64", manifestPlatform: "linux-x64");
        var ex = Assert.Throws<InvalidDataException>(() =>
            TemplateManagerService.InstallZip(zip, "x64", Path.Combine(_root, "c1"), "asset.zip", 1, "v1"));
        Assert.Contains("platform mismatch", ex.Message);
    }

    [Fact]
    public void InstallZip_Incomplete_Throws()
    {
        var zip = BuildZip("x64", includeLoader: false);
        var ex = Assert.Throws<InvalidDataException>(() =>
            TemplateManagerService.InstallZip(zip, "x64", Path.Combine(_root, "c2"), "asset.zip", 1, "v1"));
        Assert.Contains("missing", ex.Message);
    }

    [Fact]
    public void InstallZip_MissingManifest_Throws()
    {
        var zip = BuildZip("x64", includeManifest: false);
        var ex = Assert.Throws<InvalidDataException>(() =>
            TemplateManagerService.InstallZip(zip, "x64", Path.Combine(_root, "c3"), "asset.zip", 1, "v1"));
        Assert.Contains("manifest.json", ex.Message);
    }

    [Fact]
    public void InstallZip_MissingModules_AreOptional()
    {
        // win-arm64 templates ship a reduced module set (no QuickJS script
        // module); the install must succeed and report the absent modules.
        var path = Path.Combine(_root, "tpl-min.zip");
        using (var zip = ZipFile.Open(path, ZipArchiveMode.Create))
        {
            AddEntry(zip, "manifest.json",
                """{"platform":"win-arm64","tag":"v1.0.0","commit":"cafe","built_at":"2026-09-03T00:00:00Z"}""");
            AddEntry(zip, "loader.exe", "loader payload");
            AddEntry(zip, "loader_desktop.exe", "desktop payload");
            AddEntry(zip, "core.dll", "core payload");
            AddEntry(zip, "shell.dll", "shell module");
        }
        var install = TemplateManagerService.InstallZip(path, "win-arm64", Path.Combine(_root, "c-min"), "asset.zip", 1, "v1");
        Assert.Contains("script.dll", install.MissingModules);
        Assert.DoesNotContain("shell.dll", install.MissingModules);
        Assert.Equal(6, install.MissingModules.Length);
        Assert.Equal("v1.0.0", install.Tag);
    }

    [Fact]
    public void PayloadNames_MatchPlatformLayout()
    {
        Assert.Equal(("loader.exe", "loader_desktop.exe", "core.dll"), TemplateManagerService.PayloadNames("x64"));
        Assert.Equal(("loader", null, "libcore.so"), TemplateManagerService.PayloadNames("linux-arm64"));
        Assert.Equal(("loader", null, "libcore.dylib"), TemplateManagerService.PayloadNames("mac-arm64"));
    }
}
