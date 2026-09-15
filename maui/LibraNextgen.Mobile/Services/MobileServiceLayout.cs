namespace LibraNextgen.Mobile.Services;

/// <summary>
/// Where the embedded service keeps its state on a mobile device.
///
/// Everything lives inside the app's private data directory
/// (<c>/data/data/&lt;package&gt;/files</c> on Android), which is the mobile
/// equivalent of the Electron shell's <c>userData</c> directory: writable
/// without any permission, removed when the user uninstalls the app.
///
/// The desktop shell writes a <c>libra.conf.json</c> the user can edit (SQLite
/// or MongoDB). The mobile app writes the same file, but the content is fixed:
/// mobile is SQLite-only and the user never has to know — see
/// <see cref="LocalServiceHost.WriteConfigAsync"/>.
/// </summary>
public static class MobileServiceLayout
{
    /// <summary>Preferred loopback port; the same default the desktop shell uses.</summary>
    public const int PreferredPort = 5270;

    /// <summary>App-private root: the mobile analogue of Electron's <c>userData</c>.</summary>
    public static string DataRoot => FileSystem.AppDataDirectory;

    public static string ConfigPath => Path.Combine(DataRoot, "libra.conf.json");

    public static string DatabasePath => Path.Combine(DataRoot, "data", "libra.db");

    /// <summary>Extracted React console (kept fresh from the bundled zip).</summary>
    public static string WebRoot => Path.Combine(DataRoot, "web");

    public static string LogDirectory => Path.Combine(DataRoot, "logs");

    public static string AppLogPath => Path.Combine(LogDirectory, "app.log");

    /// <summary>Persisted agent beacon signing key (the service writes it here).</summary>
    public static string ServerKeyPath => Path.Combine(DataRoot, "server-rsa.key");

    /// <summary>
    /// Payload-builder output root (<c>LIBRA_BUILDS_DIR</c>). The builder would
    /// otherwise derive it from the assembly path, which on Android resolves to
    /// the read-only filesystem root and fails with "Access to the path
    /// '/data/build-output' is denied".
    /// </summary>
    public static string BuildOutputRoot => Path.Combine(DataRoot, "build-output");

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(DataRoot);
        Directory.CreateDirectory(Path.GetDirectoryName(DatabasePath)!);
        Directory.CreateDirectory(LogDirectory);
        Directory.CreateDirectory(BuildOutputRoot);
    }
}
