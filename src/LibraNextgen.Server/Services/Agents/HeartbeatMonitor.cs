using System.Text.Json;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Service.Services.Agents;

/// <summary>
/// Periodically checks for agents whose heartbeat has timed out and marks them offline.
/// </summary>
public class HeartbeatMonitor : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<HeartbeatMonitor> _logger;
    private static readonly TimeSpan CheckInterval = TimeSpan.FromSeconds(10);
    // Offline threshold. The agent's liveness is also refreshed by the SSE event
    // stream every 30s, so a 60s gap means BOTH the beacon heartbeats AND the SSE
    // connection have stopped — a much more reliable "really gone" signal than
    // relying on heartbeats alone under transient network jitter.
    private static readonly TimeSpan TimeoutThreshold = TimeSpan.FromSeconds(60);

    public HeartbeatMonitor(IServiceScopeFactory scopeFactory, ILogger<HeartbeatMonitor> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Heartbeat monitor started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(CheckInterval, stoppingToken);
                await CheckStaleAgentsAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Heartbeat monitor check failed.");
            }
        }
    }

    private async Task CheckStaleAgentsAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var agentService = scope.ServiceProvider.GetRequiredService<AgentService>();
        var wsManager = scope.ServiceProvider.GetRequiredService<ConnectionManager>();

        var onlineAgents = await agentService.GetOnlineAsync(ct);
        var stale = onlineAgents
            .Where(a => DateTime.UtcNow - a.LastSeen > TimeoutThreshold)
            .ToList();

        foreach (var agent in stale)
        {
            // Don't mark offline if WS is still connected (heartbeat may have lagged but WS is alive)
            if (wsManager.IsAgentConnected(agent.Id))
                continue;

            _logger.LogInformation("Agent {AgentId} ({Hostname}) heartbeat timed out — marking offline.", agent.Id, agent.Hostname);

            try
            {
                await agentService.UpdateStatusAsync(agent.Id, AgentStatus.Offline, ct);

                var msg = new WebSocketMessage
                {
                    Type = "agent.status",
                    Channel = agent.Id,
                    Data = JsonSerializer.SerializeToElement(new { agentId = agent.Id, status = "Offline" })
                };
                await wsManager.BroadcastToConsoleAsync(msg, ct);
                wsManager.AppendEvent("agent", $"Agent {agent.Hostname} ({agent.IpAddress}) 离线");

                var notifier = scope.ServiceProvider.GetRequiredService<AiEventNotifier>();
                _ = notifier.NotifyAsync(agent.Id, agent.Hostname, agent.IpAddress, AiEventNotifier.EvtAgentOffline, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to mark agent {AgentId} offline.", agent.Id);
            }
        }
    }
}
