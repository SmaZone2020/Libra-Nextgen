using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LibraDesktop.Core;

/// <summary>
/// User-facing shell settings, persisted as JSON under AppPaths.SettingsFile.
/// Kept intentionally small: this shell is a launcher, not a configuration hub.
/// </summary>
public sealed class AppSettings
{
    /// <summary>Last web entry point the user connected to (local or remote).</summary>
    public string? EntryUrl { get; set; }

    /// <summary>GitHub repo the updater pulls backend bundles from.</summary>
    [JsonPropertyName("github")]
    public GitHubSource GitHub { get; set; } = new();

    public sealed class GitHubSource
    {
        public string Owner { get; set; } = "SmaZone2020";

        public string Repo { get; set; } = "Libra-Nextgen";

        /// <summary>Asset name prefix on a release, e.g. libra-desktop-win-x64-.</summary>
        public string AssetPrefix { get; set; } = "libra-desktop-win-x64-";
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    public static AppSettings Load()
    {
        AppPaths.EnsureDirectories();
        try
        {
            if (File.Exists(AppPaths.SettingsFile))
            {
                var json = File.ReadAllText(AppPaths.SettingsFile);
                return JsonSerializer.Deserialize<AppSettings>(json, JsonOpts) ?? new AppSettings();
            }
        }
        catch (Exception ex)
        {
            // Corrupt settings must not brick startup; fall back to defaults.
            System.Diagnostics.Debug.WriteLine($"settings load failed: {ex.Message}");
        }
        return new AppSettings();
    }

    public void Save()
    {
        AppPaths.EnsureDirectories();
        try
        {
            File.WriteAllText(AppPaths.SettingsFile,
                JsonSerializer.Serialize(this, JsonOpts));
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"settings save failed: {ex.Message}");
        }
    }
}

