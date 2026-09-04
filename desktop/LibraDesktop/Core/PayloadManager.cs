using System.IO;
using System.IO.Compression;
using System.Text.Json;

namespace LibraDesktop.Core;

/// <summary>version.json shipped inside a desktop bundle.</summary>
public sealed class PayloadManifest
{
    /// <summary>Source release tag this bundle was built from, e.g. "1.7.0".</summary>
    public string Tag { get; set; } = "";

    /// <summary>Backend executable file name. When empty the first *.exe is used.</summary>
    public string? Backend { get; set; }

    /// <summary>Loopback port the backend listens on.</summary>
    public int Port { get; set; } = 5270;

    /// <summary>Console static files directory relative to the payload root.</summary>
    public string? WebRoot { get; set; } = "web";
}

/// <summary>An unpacked, verified bundle on disk.</summary>
public sealed class InstalledPayload
{
    public required string RootDir { get; init; }

    public required PayloadManifest Manifest { get; init; }

    public required string BackendExe { get; init; }

    public string EntryUrl => $"http://127.0.0.1:{Manifest.Port}/";
}

/// <summary>
/// Installs and inspects backend bundles under AppPaths.PayloadDir.
/// Layout: latest/ (active) and latest.prev/ (rollback slot).
/// </summary>
public static class PayloadManager
{
    public static InstalledPayload? ScanActive()
    {
        var root = AppPaths.ActivePayloadDir;
        if (!Directory.Exists(root))
            return null;

        var manifestFile = FindManifest(root);
        if (manifestFile is null)
            return null;

        try
        {
            var manifest = JsonSerializer.Deserialize<PayloadManifest>(
                File.ReadAllText(manifestFile), JsonOpts);
            if (manifest is null || string.IsNullOrWhiteSpace(manifest.Tag))
                return null;

            var exe = ResolveBackend(Path.GetDirectoryName(manifestFile)!, manifest);
            if (exe is null)
                return null;

            return new InstalledPayload
            {
                RootDir = Path.GetDirectoryName(manifestFile)!,
                Manifest = manifest,
                BackendExe = exe,
            };
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Install a downloaded bundle zip into the active slot.
    /// The previous active install moves to the rollback slot (old rollback is
    /// dropped). Callers must stop a running owned backend first.
    /// </summary>
    public static async Task<InstalledPayload> InstallAsync(string zipPath, IProgress<string>? log = null)
    {
        AppPaths.EnsureDirectories();
        var staging = Path.Combine(AppPaths.PayloadDir, "staging-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        try
        {
            log?.Report($"Extracting {Path.GetFileName(zipPath)} ...");
            await Task.Run(() => ZipFile.ExtractToDirectory(zipPath, staging));

            var manifestFile = FindManifest(staging)
                ?? throw new InvalidDataException("bundle has no version.json");
            var manifest = JsonSerializer.Deserialize<PayloadManifest>(
                File.ReadAllText(manifestFile), JsonOpts)
                ?? throw new InvalidDataException("bundle version.json is invalid");
            if (string.IsNullOrWhiteSpace(manifest.Tag))
                throw new InvalidDataException("bundle version.json has no tag");

            var bundleRoot = Path.GetDirectoryName(manifestFile)!;
            var exe = ResolveBackend(bundleRoot, manifest)
                ?? throw new InvalidDataException($"no backend executable found in {bundleRoot}");

            // Swap slots: keep previous active as rollback, drop the old rollback.
            if (Directory.Exists(AppPaths.PreviousPayloadDir))
                Directory.Delete(AppPaths.PreviousPayloadDir, recursive: true);
            if (Directory.Exists(AppPaths.ActivePayloadDir))
                Directory.Move(AppPaths.ActivePayloadDir, AppPaths.PreviousPayloadDir);
            Directory.Move(staging, AppPaths.ActivePayloadDir);

            var relRoot = Path.GetRelativePath(staging, bundleRoot);
            var newRoot = Path.Combine(AppPaths.ActivePayloadDir, relRoot);
            var newManifest = FindManifest(newRoot)!;
            var newExe = ResolveBackend(newRoot, manifest)!;

            log?.Report($"Installed bundle tag {manifest.Tag} to {newRoot}");
            return new InstalledPayload
            {
                RootDir = newRoot,
                Manifest = manifest,
                BackendExe = newExe,
            };
        }
        finally
        {
            if (Directory.Exists(staging))
            {
                try { Directory.Delete(staging, recursive: true); }
                catch { /* best effort cleanup */ }
            }
        }
    }

    private static string? FindManifest(string root)
    {
        // Manifest sits at the zip root or inside one nesting level
        // (producers often wrap the payload in a folder).
        var direct = Path.Combine(root, "version.json");
        if (File.Exists(direct))
            return direct;
        foreach (var sub in Directory.EnumerateDirectories(root))
        {
            var nested = Path.Combine(sub, "version.json");
            if (File.Exists(nested))
                return nested;
        }
        return null;
    }

    private static string? ResolveBackend(string root, PayloadManifest manifest)
    {
        if (!string.IsNullOrWhiteSpace(manifest.Backend))
        {
            var named = Path.Combine(root, manifest.Backend);
            if (File.Exists(named))
                return named;
        }
        return Directory.EnumerateFiles(root, "*.exe").FirstOrDefault();
    }

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };
}
