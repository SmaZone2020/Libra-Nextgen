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
    // Each agent's offline threshold is its self-declared heartbeat interval
    // plus a fixed 5s grace (see HeartbeatTiming). A live SSE event stream or
    // agent WebSocket is independent liveness proof and keeps the agent online
    // even if an individual heartbeat is late under jitter.

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
        var eventHub = scope.ServiceProvider.GetRequiredService<AgentEventHub>();

        var onlineAgents = await agentService.GetOnlineAsync(ct);
        var stale = onlineAgents
            .Where(a => DateTime.UtcNow - a.LastSeen > HeartbeatTiming.GetOfflineTimeout(a))
            .ToList();

        foreach (var agent in stale)
        {
            // Don't mark offline while an SSE stream or WS is still connected
            // (heartbeat may have lagged but the agent process is alive).
            if (eventHub.IsSubscribed(agent.Id) || wsManager.IsAgentConnected(agent.Id))
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
