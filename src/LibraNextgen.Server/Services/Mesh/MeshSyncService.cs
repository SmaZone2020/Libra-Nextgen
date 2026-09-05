using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text.Json;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Services.Ai;

namespace LibraNextgen.Service.Services.Mesh;

/// <summary>Minimal remote agent facts used for online/offline tracking.</summary>
public sealed record MeshAgentSnapshot(string AgentId, string Hostname, string IpAddress);

/// <summary>
/// Bridges agent online/offline transitions of every connected mesh node into
/// the existing AI event pipeline (AiEventNotifier), so Justitia subscriptions
/// ("agent.online" / "agent.offline") fire for remote nodes exactly like for
/// local agents. Polling is intentionally simple: agent lists are small and a
/// few seconds of latency is acceptable for an assistant notification.
///
/// State is in-memory only: the first poll after a node (re)connects is taken
/// as the baseline and produces no events, so a connect never triggers a
/// storm of bogus "online" notifications.
/// </summary>
public sealed class MeshSyncService : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan FetchTimeout = TimeSpan.FromSeconds(15);

    private readonly IStore<MeshNode> _nodes;
    private readonly MeshSessionManager _sessions;
    private readonly AiEventNotifier _notifier;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<MeshSyncService> _logger;

    private readonly ConcurrentDictionary<string, Dictionary<string, MeshAgentSnapshot>> _lastByNode = new();

    public MeshSyncService(
        IStore<MeshNode> nodes,
        MeshSessionManager sessions,
        AiEventNotifier notifier,
        IHttpClientFactory http,
        ILogger<MeshSyncService> logger)
    {
        _nodes = nodes;
        _sessions = sessions;
        _notifier = notifier;
        _http = http;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Mesh sync tick failed; continuing");
            }

            try
            {
                await Task.Delay(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        var nodes = await _nodes.GetAllAsync(ct);

        foreach (var node in nodes)
        {
            var session = _sessions.GetSession(node.Id);
            if (session is null)
            {
                _lastByNode.TryRemove(node.Id, out _);
                continue;
            }

            Dictionary<string, MeshAgentSnapshot> current;
            try
            {
                current = await FetchAgentsAsync(node, session.Token, ct);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Mesh sync fetch failed for node {NodeId}; keeping last state", node.Id);
                continue;
            }

            if (!_lastByNode.TryGetValue(node.Id, out var previous))
            {
                // Baseline poll after connect: no notifications.
                _lastByNode[node.Id] = current;
                continue;
            }

            foreach (var (agentId, snap) in current)
            {
                if (!previous.ContainsKey(agentId))
                {
                    var displayHost = $"{node.Name} · {snap.Hostname}";
                    await _notifier.NotifyAsync(agentId, displayHost, snap.IpAddress,
                        AiEventNotifier.EvtAgentOnline, ct);
                }
            }

            foreach (var (agentId, snap) in previous)
            {
                if (!current.ContainsKey(agentId))
                {
                    var displayHost = $"{node.Name} · {snap.Hostname}";
                    await _notifier.NotifyAsync(agentId, displayHost, snap.IpAddress,
                        AiEventNotifier.EvtAgentOffline, ct);
                }
            }

            _lastByNode[node.Id] = current;
        }
    }

    private async Task<Dictionary<string, MeshAgentSnapshot>> FetchAgentsAsync(
        MeshNode node, string token, CancellationToken ct)
    {
        using var client = _http.CreateClient();
        client.Timeout = FetchTimeout;

        using var req = new HttpRequestMessage(HttpMethod.Get, $"{node.Origin}/api/agents?page=1&pageSize=500");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.TryAddWithoutValidation("Accept", "application/json");

        using var resp = await client.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        var text = await resp.Content.ReadAsStringAsync(ct);

        var result = new Dictionary<string, MeshAgentSnapshot>();
        using var doc = JsonDocument.Parse(text);
        if (!doc.RootElement.TryGetProperty("agents", out var agents) || agents.ValueKind != JsonValueKind.Array)
            return result;

        foreach (var item in agents.EnumerateArray())
        {
            var id = item.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
            if (string.IsNullOrEmpty(id)) continue;

            var status = item.TryGetProperty("status", out var st) ? st.GetString() : "";
            if (!string.Equals(status, "Online", StringComparison.OrdinalIgnoreCase)) continue;

            var hostname = item.TryGetProperty("hostname", out var hn) ? hn.GetString() ?? "" : "";
            var ip = item.TryGetProperty("ipAddress", out var ipProp) ? ipProp.GetString() ?? "" : "";
            result[id] = new MeshAgentSnapshot(id, hostname, ip);
        }

        return result;
    }
}
