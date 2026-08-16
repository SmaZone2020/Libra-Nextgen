namespace LibraNextgen.Common.Models;

public class AccessKey
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    /// <summary>SHA-256 hash of the raw key — the raw key is never stored.</summary>
    public string KeyHash { get; set; } = "";
    /// <summary>Role granted to callers authenticating with this key.</summary>
    public string Role { get; set; } = UserRole.Operator.ToString();
    public string CreatedByUserId { get; set; } = "";
    public string CreatedByUserName { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAt { get; set; }
    public DateTime? LastUsedAt { get; set; }
    public bool IsActive { get; set; } = true;
}
