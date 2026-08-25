namespace LibraNextgen.Service.Models;

/// <summary>
/// Persisted per-agent AES-256 session key. Survives a server restart so an
/// agent can reconnect and reuse its established key without re-negotiating.
/// </summary>
public class SessionKey
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string AgentId { get; set; } = string.Empty;
    /// <summary>Base64-encoded AES-256 key.</summary>
    public string Key { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
