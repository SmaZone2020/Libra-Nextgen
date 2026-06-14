using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class BuilderTools
{
    [McpServerTool, Description("List all build records")]
    public static async Task<string> list_builds(
        [Description("Not used")] string? _dummy = null)
    {
        var api = $"Use the REST API GET /api/builder/list to fetch builds.";
        return api;
    }

    [McpServerTool, Description("Get build status and details")]
    public static async Task<string> get_build_info(
        [Description("Build ID")] string buildId)
    {
        return $"Use the REST API GET /api/builder/info/{buildId} to fetch build details.";
    }
}
