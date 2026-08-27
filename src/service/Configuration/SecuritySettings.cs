namespace LibraNextgen.Service.Configuration;

/// <summary>
/// 安全设置。与监听设置共用同一本地设置文件（%APPDATA%\Libra-Nextgen\settings.json），
/// 由 <c>SettingsController</c> 读取/更新。
/// </summary>
public class SecuritySettings
{
    public const string SectionName = "Security";

    /// <summary>
    /// 局域网/内网开放：允许来自局域网（private 网段）的请求访问控制台与 API。
    /// 默认开启（C2 内网对抗场景）；仅本机回环监听时该项不生效。
    /// </summary>
    public bool OpenLan { get; set; } = true;

    /// <summary>允许跨域访问的前端来源（开发机 / Vite 等），为空时后端按 OpenLan 放行。</summary>
    public List<string> AllowedOrigins { get; set; } = new();
}

/// <summary>从本地设置文件加载安全设置（进程启动时调用一次）。</summary>
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
