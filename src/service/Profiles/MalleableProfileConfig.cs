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

    public string RegisterPath { get; set; } = "/api/v1/user/profile";
    public string HeartbeatPath { get; set; } = "/api/v1/user/status";
    public string ResultPath { get; set; } = "/api/v1/user/avatar";
    public string WebSocketPath { get; set; } = "/ws/chat";

    public string UserAgent { get; set; } = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
    public Dictionary<string, string> CustomHeaders { get; set; } = new();

    public int HeartbeatIntervalSeconds { get; set; } = 30;
    public double JitterPercent { get; set; } = 0.2;
}
