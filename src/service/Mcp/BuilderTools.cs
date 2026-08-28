using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class BuilderTools
{
    [McpServerTool, Description("List all build records (id, platform, file, size, status, timestamps)")]
    public static string list_builds()
    {
        var history = BuilderBuildService.LoadHistory();
        var items = history.Select(r => new
        {
            r.Id,
            r.Platform,
            r.FileName,
            r.FileSize,
            r.Status,
            r.Error,
            r.CreatedAt,
            r.CompletedAt,
        });
        return McpUtils.Limit(JsonSerializer.Serialize(items, McpUtils.JsonOpts));
    }

    [McpServerTool, Description("Get build status, error and live logs for a specific build")]
    public static string get_build_info(
        [Description("Build ID")] string buildId)
    {
        var history = BuilderBuildService.LoadHistory();
        var record = history.FirstOrDefault(r => r.Id == buildId);
        if (record == null)
            return McpUtils.Error($"build '{buildId}' not found");

        var logs = BuilderBuildService.ActiveJobs.TryGetValue(buildId, out var job)
            ? job.GetLogs()
            : null;

        return McpUtils.Limit(JsonSerializer.Serialize(new
        {
            record.Id,
            record.Platform,
            record.FileName,
            record.FileSize,
            record.Status,
            record.Error,
            record.CreatedAt,
            record.CompletedAt,
            liveLogs = logs,
        }, McpUtils.JsonOpts));
    }
}