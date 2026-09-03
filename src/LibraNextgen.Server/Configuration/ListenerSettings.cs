namespace LibraNextgen.Service.Configuration;

/// <summary>
/// </summary>
public class ListenerSettings
{
    public const string SectionName = "Listener";

    public int Port { get; set; } = 5270;

    public string Host { get; set; } = "0.0.0.0";

    public bool BindLoopbackOnly { get; set; }

    public string ListenUrl => $"http://{(BindLoopbackOnly ? "127.0.0.1" : Host)}:{Port}";
}

public static class ListenerSettingsLoader
{
    private static readonly string SettingsDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Libra-Nextgen");
    private static readonly string SettingsPath = Path.Combine(SettingsDir, "settings.json");

    public static ListenerSettings Load()
    {
        try
        {
            if (File.Exists(SettingsPath))
            {
                var json = File.ReadAllText(SettingsPath);
                var parsed = System.Text.Json.JsonSerializer.Deserialize<ListenerSettings>(json);
                if (parsed is { Port: >= 1 and <= 65535 })
                    return parsed;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[settings] failed to load listener settings: {ex.Message}");
        }
        return new ListenerSettings();
    }
}
