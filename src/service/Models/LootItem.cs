namespace LibraNextgen.Service.Models;

/// <summary>
/// A loot entry: a captured screenshot or a registered download, backed by a
/// file on disk.
/// </summary>
public class LootItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string AgentId { get; set; } = string.Empty;
    /// <summary>"screenshot" | "download"</summary>
    public string Kind { get; set; } = "screenshot";
    public string Name { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public long Size { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
