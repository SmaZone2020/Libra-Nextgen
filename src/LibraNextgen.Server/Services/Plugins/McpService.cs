using System.ComponentModel;
using System.Reflection;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using ModelContextProtocol.Server;

namespace LibraNextgen.Service.Services.Plugins;

public sealed record McpToolInfo(string Name, string Description);

/// <summary>
/// Holds the MCP server enabled flag (persisted as a single config document)
/// and enumerates the registered MCP tools.
/// </summary>
public class McpService
{
    private readonly IStore<McpConfig> _store;
    private volatile bool _enabled = true;

    public McpService(IStore<McpConfig> store)
    {
        _store = store;
    }

    public bool Enabled => _enabled;

    public async Task LoadAsync(CancellationToken ct = default)
    {
        try
        {
            var config = await _store.FirstOrDefaultAsync(_ => true, ct);
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
        var config = await _store.FirstOrDefaultAsync(_ => true, ct);
        if (config == null)
        {
            try
            {
                await _store.InsertAsync(new McpConfig { Enabled = enabled }, ct);
            }
            catch (DuplicateKeyException)
            {
                // Concurrent first-save: another writer created the document.
                var concurrent = await _store.FirstOrDefaultAsync(_ => true, ct);
                if (concurrent is not null)
                    await _store.UpdateByIdAsync(concurrent.Id,
                        new[] { new FieldUpdate(nameof(McpConfig.Enabled), enabled) }, ct);
            }
        }
        else
        {
            await _store.UpdateByIdAsync(config.Id,
                new[] { new FieldUpdate(nameof(McpConfig.Enabled), enabled) }, ct);
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
