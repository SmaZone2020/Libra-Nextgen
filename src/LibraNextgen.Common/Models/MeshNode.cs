namespace LibraNextgen.Common.Models;

/// <summary>
/// Registered remote Libra service that this home server (the mesh hub)
/// can connect to. The id is the hub-assigned unique nodeId; the name is a
/// free-form display label chosen by the operator. Credentials are stored
/// protected (see MeshSecrets) — raw secrets never touch the store.
/// </summary>
public class MeshNode
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    /// <summary>Display name (required, unique among mesh nodes).</summary>
    public string Name { get; set; } = "";
    /// <summary>Base origin of the node service: http(s)://host[:port] (no path).</summary>
    public string Origin { get; set; } = "";
    public MeshAuthKind AuthKind { get; set; }
    /// <summary>Account name for Password auth; unused for AccessKey auth.</summary>
    public string Username { get; set; } = "";
    /// <summary>Protected secret: password (Password) or raw lnk_ key (AccessKey).</summary>
    public string SecretCipher { get; set; } = "";
    public string CreatedByUserId { get; set; } = "";
    public string CreatedByUserName { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? LastConnectedAt { get; set; }
    /// <summary>Most recent connect failure detail (cleared on success).</summary>
    public string? LastError { get; set; }
}
