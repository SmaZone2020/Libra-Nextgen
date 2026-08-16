namespace LibraNextgen.Common.Models;

/// <summary>
/// Admin-configurable risk policy. Maps a canonical action key to a risk level.
/// </summary>
public class RiskPolicy
{
    public string Id { get; set; } = "default";
    public Dictionary<string, RiskLevel> Mappings { get; set; } = new();
}
