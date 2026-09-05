using System.Text.Json;
using System.Text.Json.Serialization;

namespace LibraNextgen.Service.Configuration;

/// <summary>
/// Desktop user configuration file (<c>libra.conf.json</c>), the single source
/// of truth for how the service starts when launched by the Electron shell.
/// Written only by the shell; the service reads it at startup. Absent in cloud
/// deployments, where appsettings/env keep driving behavior unchanged.
/// Contract: docs/desktop-electron-architecture.md (§ user config).
/// </summary>
public sealed class UserConfig
{
    public const string FileName = "libra.conf.json";

    /// <summary>Configuration schema version; bump on incompatible changes.</summary>
    public int SchemaVersion { get; set; } = 1;

    public UserStorageConfig Storage { get; set; } = new();

    public UserListenerConfig? Listener { get; set; }

    public static UserConfig Default { get; } = new();
}

public sealed class UserStorageConfig
{
    /// <summary>sqlite | mongo. Defaults to sqlite (desktop-first semantics).</summary>
    public string Mode { get; set; } = "sqlite";

    /// <summary>Mongo connection string; mongo mode only.</summary>
    public string? ConnectString { get; set; }

    /// <summary>SQLite database file path; empty = &lt;userDataDir&gt;/data/libra.db.
    /// Always held (also in mongo mode) so the path is a single source.</summary>
    public string? DbPath { get; set; }
}

public sealed class UserListenerConfig
{
    public int Port { get; set; } = 5270;

    public bool BindLoopback { get; set; } = true;
}

/// <summary>DI carrier so later phases can query where/how the config loaded.</summary>
public sealed record UserConfigSource(string SourcePath, UserConfig Config);

public static class UserConfigLoader
{
    /// <summary>
    /// Resolve and parse the user config file. Precedence for the user data
    /// directory: CLI <c>--user-data-dir</c>, env <c>LIBRA_USER_DATA_DIR</c>,
    /// then the per-OS application-data default (<c>LibraDesktop</c>).
    /// Returns null (and never throws) when no file exists or it is unreadable
    /// — cloud behavior must stay identical to today.
    /// </summary>
    public static UserConfig? TryLoad(IConfiguration cli, out string? sourcePath)
    {
        sourcePath = null;

        var dir = cli["user-data-dir"] ?? Environment.GetEnvironmentVariable("LIBRA_USER_DATA_DIR");
        string? path = null;
        if (!string.IsNullOrWhiteSpace(dir))
        {
            path = Path.Combine(dir, UserConfig.FileName);
        }
        else
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (!string.IsNullOrWhiteSpace(appData))
            {
                var candidate = Path.Combine(appData, "LibraDesktop", UserConfig.FileName);
                if (File.Exists(candidate))
                    path = candidate;
            }
        }

        if (path is null || !File.Exists(path))
            return null;

        try
        {
            var options = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                ReadCommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true,
                // Unknown keys are tolerated so future fields do not break older binaries.
                UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip,
            };
            var config = JsonSerializer.Deserialize<UserConfig>(File.ReadAllText(path), options);
            if (config is null)
                return null;

            if (config.SchemaVersion is < 1 or > 1)
                return null; // unknown schema — refuse rather than guess
            if (config.Storage.Mode is not ("sqlite" or "mongo"))
                config.Storage.Mode = UserConfig.Default.Storage.Mode;

            sourcePath = path;
            return config;
        }
        catch (Exception)
        {
            // Unreadable config must never prevent startup; defaults apply.
            return null;
        }
    }

    /// <summary>
    /// Overlay CLI override keys (--store/--connect/--dbpath) on top of the
    /// loaded file config. Returns null only when neither a file config nor
    /// any override key exists (pure cloud launch). A missing file with
    /// overrides behaves like a desktop config (sqlite default) so portable
    /// launches can run without writing libra.conf.json.
    /// </summary>
    public static UserConfig? MergeOverrides(UserConfig? baseConfig, IConfiguration cli)
    {
        var store = cli["store"];
        var connect = cli["connect"];
        var dbPath = cli["dbpath"];
        if (store is null && connect is null && dbPath is null)
            return baseConfig;

        var config = baseConfig ?? new UserConfig();
        if (store is "sqlite" or "mongo")
            config.Storage.Mode = store;
        if (connect is not null)
            config.Storage.ConnectString = connect;
        if (dbPath is not null)
            config.Storage.DbPath = dbPath;
        return config;
    }
}
