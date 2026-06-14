namespace LibraNextgen.Common.Models;

public class AccessKey
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public string Key { get; set; } = "";
    public string CreatedByUserId { get; set; } = "";
    public string CreatedByUserName { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAt { get; set; }
    public DateTime? LastUsedAt { get; set; }
    public bool IsActive { get; set; } = true;
}
