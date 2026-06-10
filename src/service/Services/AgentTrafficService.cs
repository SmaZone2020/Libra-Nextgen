using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Accumulates per-agent traffic bytes in memory and flushes to MongoDB periodically.
/// Singleton — all WS/HTTP/SSE paths feed into this, then it batch-writes to DB.
/// </summary>
public class AgentTrafficService
{
    private readonly object _lock = new();
    private readonly Dictionary<string, TrafficEntry> _entries = new();
    private readonly IServiceScopeFactory _scopeFactory;

    public AgentTrafficService(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
        _ = Task.Run(FlushLoopAsync);
    }

    private async Task FlushLoopAsync()
    {
        while (true)
        {
            await Task.Delay(TimeSpan.FromSeconds(30));
            try { await FlushAsync(); }
            catch { /* best-effort periodic flush */ }
        }
    }

    public void Accumulate(string agentId, string hostname, long bytesReceived, long bytesSent)
    {
        lock (_lock)
        {
            if (!_entries.TryGetValue(agentId, out var entry))
            {
                entry = new TrafficEntry { Hostname = hostname };
                _entries[agentId] = entry;
            }
            entry.BytesReceived += bytesReceived;
            entry.BytesSent += bytesSent;
            if (!string.IsNullOrEmpty(hostname) && hostname != "unknown")
                entry.Hostname = hostname;
        }
    }

    /// <summary>
    /// Flushes accumulated traffic to MongoDB and returns a snapshot for broadcast.
    /// </summary>
    public async Task<Dictionary<string, (long Received, long Sent)>> FlushAsync()
    {
        Dictionary<string, TrafficEntry> snapshot;
        lock (_lock)
        {
            if (_entries.Count == 0)
                return new Dictionary<string, (long, long)>();
            snapshot = new Dictionary<string, TrafficEntry>(_entries);
            _entries.Clear();
        }

        using var scope = _scopeFactory.CreateScope();
        var trafficRepo = scope.ServiceProvider.GetRequiredService<Repository<TrafficRecord>>();

        var records = snapshot.Select(kv => new TrafficRecord
        {
            AgentId = kv.Key,
            Hostname = kv.Value.Hostname,
            BytesReceived = kv.Value.BytesReceived,
            BytesSent = kv.Value.BytesSent
        }).ToList();

        await trafficRepo.InsertManyAsync(records);

        return snapshot.ToDictionary(
            kv => kv.Key,
            kv => (kv.Value.BytesReceived, kv.Value.BytesSent));
    }

    private sealed class TrafficEntry
    {
        public string Hostname { get; set; } = "unknown";
        public long BytesReceived { get; set; }
        public long BytesSent { get; set; }
    }
}
