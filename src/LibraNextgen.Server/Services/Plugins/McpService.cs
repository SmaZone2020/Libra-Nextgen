using System.ComponentModel;
using System.Reflection;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using ModelContextProtocol.Server;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services.Plugins;

public sealed record McpToolInfo(string Name, string Description);

/// <summary>
/// Holds the MCP server enabled flag and enumerates the registered MCP tools.
/// </summary>
public class McpService
{
    private readonly IMongoCollection<McpConfig> _collection;
    private volatile bool _enabled = true;

    public McpService(MongoDbContext context)
    {
        _collection = context.GetCollection<McpConfig>("mcp_config");
    }

    public bool Enabled => _enabled;

    public async Task LoadAsync(CancellationToken ct = default)
    {
        try
        {
            var config = await _collection.Find(FilterDefinition<McpConfig>.Empty).FirstOrDefaultAsync(ct);
            _enabled = config?.Enabled ?? true;
        }
        catch
        {
            _enabled = false;
            throw;
        }
    }

    public async Task SetEnabledAsync(bool enabled, CancellationToken ct = default)
    {
        _enabled = enabled;
        var config = await _collection.Find(FilterDefinition<McpConfig>.Empty).FirstOrDefaultAsync(ct);
        if (config == null)
        {
            await _collection.InsertOneAsync(new McpConfig { Enabled = enabled }, cancellationToken: ct);
        }
        else
        {
            await _collection.UpdateOneAsync(
                Builders<McpConfig>.Filter.Eq(c => c.Id, config.Id),
                Builders<McpConfig>.Update.Set(c => c.Enabled, enabled),
                cancellationToken: ct);
        }
    }

    /// <summary>Enumerate all MCP tools registered via [McpServerTool].</summary>
    public static List<McpToolInfo> GetTools()
    {
        var result = new List<McpToolInfo>();
        foreach (var type in typeof(McpService).Assembly.GetTypes())
        {
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Static))
            {
                var tool = method.GetCustomAttribute<McpServerToolAttribute>();
                if (tool == null) continue;

                var description = method.GetCustomAttribute<DescriptionAttribute>()?.Description ?? string.Empty;
                result.Add(new McpToolInfo(method.Name, description));
            }
        }
        return result.OrderBy(t => t.Name).ToList();
    }
}
