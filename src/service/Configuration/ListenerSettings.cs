namespace LibraNextgen.Service.Configuration;

/// <summary>
/// 后端 HTTP 监听设置。端口保存在本地设置文件（%APPDATA%\Libra-Nextgen\settings.json），
/// 由 <c>SettingsController</c> 读取/更新；修改端口后 Kestrel 重新绑定监听。
/// </summary>
public class ListenerSettings
{
    public const string SectionName = "Listener";

    /// <summary>HTTP 监听端口（默认 5270）。</summary>
    public int Port { get; set; } = 5270;

    /// <summary>监听地址（默认所有网卡）。</summary>
    public string Host { get; set; } = "0.0.0.0";

    /// <summary>拼接 Kestrel 监听地址。</summary>
    public string ListenUrl => $"http://{Host}:{Port}";
}

/// <summary>从本地设置文件加载监听设置（进程启动时调用一次）。</summary>
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
