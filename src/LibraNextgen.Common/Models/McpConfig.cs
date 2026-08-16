namespace LibraNextgen.Common.Models;

/// <summary>MCP server runtime configuration (single document).</summary>
public class McpConfig
{
    public string Id { get; set; } = "default";
    public bool Enabled { get; set; } = true;
}
