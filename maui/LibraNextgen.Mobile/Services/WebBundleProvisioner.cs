using System.IO.Compression;

namespace LibraNextgen.Mobile.Services;

/// <summary>
/// Unpacks the React console that ships inside the app package
/// (<c>Resources/Raw/web-bundle.zip</c>) into <see cref="MobileServiceLayout.WebRoot"/>,
/// which the embedded service then serves through <c>LIBRA_WEB_ROOT</c> — the same
/// mechanism the desktop shell uses for its <c>web/</c> payload directory.
///
/// The zip carries a <c>bundle-version.txt</c> stamp generated from the console
/// build, so a new app version re-extracts and an unchanged bundle costs one
/// file read on every later start.
/// </summary>
public static class WebBundleProvisioner
{
    private const string AssetName = "web-bundle.zip";
    private const string StampEntry = "bundle-version.txt";

    public static async Task EnsureExtractedAsync(CancellationToken cancellationToken = default)
    {
        var indexFile = Path.Combine(MobileServiceLayout.WebRoot, "index.html");
        var stampFile = Path.Combine(MobileServiceLayout.DataRoot, "web-bundle.version");

        var stamp = await ReadBundleStampAsync(cancellationToken);

        if (stamp is not null && File.Exists(indexFile) && File.Exists(stampFile)
            && File.ReadAllText(stampFile).Trim() == stamp)
        {
            AppLog.Info($"console bundle up to date ({stamp})");
            return;
        }

        // Assets come from inside the APK and are not seekable streams, so stage
        // the archive on disk before extracting it.
        var stagedZip = Path.Combine(MobileServiceLayout.DataRoot, "web-bundle.zip");
        await using (var source = await FileSystem.OpenAppPackageFileAsync(AssetName))
        await using (var target = File.Create(stagedZip))
        {
            await source.CopyToAsync(target, cancellationToken);
        }

        // Extract next to the live directory and swap, so a failure never leaves a
        // half-extracted console behind.
        var staging = MobileServiceLayout.WebRoot + ".new";
        if (Directory.Exists(staging))
            Directory.Delete(staging, recursive: true);
        Directory.CreateDirectory(staging);

        ZipFile.ExtractToDirectory(stagedZip, staging, overwriteFiles: true);
        var stagedStamp = Path.Combine(staging, StampEntry);
        if (File.Exists(stagedStamp))
            File.Delete(stagedStamp);

        if (Directory.Exists(MobileServiceLayout.WebRoot))
            Directory.Delete(MobileServiceLayout.WebRoot, recursive: true);
        Directory.Move(staging, MobileServiceLayout.WebRoot);

        if (stamp is not null)
            File.WriteAllText(stampFile, stamp);
        try
        {
            File.Delete(stagedZip);
        }
        catch
        {
        }

        AppLog.Info($"console bundle extracted to {MobileServiceLayout.WebRoot} ({stamp ?? "unknown stamp"})");
    }

    /// <summary>Reads <c>bundle-version.txt</c> from the packaged archive.</summary>
    private static async Task<string?> ReadBundleStampAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var source = await FileSystem.OpenAppPackageFileAsync(AssetName);
            using var archive = new ZipArchive(source, ZipArchiveMode.Read);
            var entry = archive.GetEntry(StampEntry);
            if (entry is null)
                return null;
            using var reader = new StreamReader(entry.Open());
            return (await reader.ReadToEndAsync(cancellationToken)).Trim();
        }
        catch (Exception ex)
        {
            AppLog.Warn($"web bundle stamp unreadable: {ex.Message}");
            return null;
        }
    }
}
