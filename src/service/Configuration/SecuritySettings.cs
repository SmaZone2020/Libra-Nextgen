namespace LibraNextgen.Service.Configuration;

/// <summary>
/// </summary>
public class SecuritySettings
{
    public const string SectionName = "Security";

    /// <summary>
    /// </summary>
    public bool OpenLan { get; set; } = true;

    public List<string> AllowedOrigins { get; set; } = new();
}

public static class SecuritySettingsLoader
{
    private static readonly string SettingsDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Libra-Nextgen");
    private static readonly string SettingsPath = Path.Combine(SettingsDir, "settings.json");

    public static SecuritySettings Load()
    {
        try
        {
            if (File.Exists(SettingsPath))
            {
                var json = File.ReadAllText(SettingsPath);
                var parsed = System.Text.Json.JsonSerializer.Deserialize<SecuritySettings>(json);
                if (parsed != null)
                    return parsed;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[settings] failed to load security settings: {ex.Message}");
        }
        return new SecuritySettings();
    }
}
