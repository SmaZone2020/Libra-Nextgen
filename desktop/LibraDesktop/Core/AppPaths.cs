using System.IO;

namespace LibraDesktop.Core;

/// <summary>
/// Well-known on-disk locations for the shell. Everything lives under
/// %LOCALAPPDATA%\LibraDesktop so the app stays portable and uninstallable
/// by deleting one folder (no registry, no admin).
/// </summary>
public static class AppPaths
{
    public static string DataDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "LibraDesktop");

    /// <summary>Unpacked backend bundles. One active install plus one rollback slot.</summary>
    public static string PayloadDir { get; } = Path.Combine(DataDir, "payload");

    public static string DownloadsDir { get; } = Path.Combine(DataDir, "downloads");

    public static string LogsDir { get; } = Path.Combine(DataDir, "logs");

    public static string SettingsFile { get; } = Path.Combine(DataDir, "settings.json");

    /// <summary>Convention used by the bundle: active payload root.</summary>
    public static string ActivePayloadDir { get; } = Path.Combine(PayloadDir, "latest");

    /// <summary>Rollback copy kept from the previous update.</summary>
    public static string PreviousPayloadDir { get; } = Path.Combine(PayloadDir, "latest.prev");

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(PayloadDir);
        Directory.CreateDirectory(DownloadsDir);
        Directory.CreateDirectory(LogsDir);
    }
}
