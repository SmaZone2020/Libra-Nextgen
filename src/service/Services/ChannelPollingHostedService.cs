using System.Collections.Concurrent;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services;

/// <summary>
/// </summary>
public class ChannelPollingHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ChannelPollingHostedService> _logger;
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _polls = new();
    private readonly ConcurrentDictionary<string, Task> _loops = new();
    private readonly ConcurrentDictionary<string, string> _cursors = new();

    public ChannelPollingHostedService(
        IServiceScopeFactory scopeFactory,
        ILogger<ChannelPollingHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("AI channel polling service started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ReconcileAsync(stoppingToken);
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "AI channel polling reconcile failed.");
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
        }
        foreach (var cts in _polls.Values) cts.Cancel();
    }

    /// <summary>
    /// </summary>
    private async Task ReconcileAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var channels = await scope.ServiceProvider
            .GetRequiredService<AiChannelService>()
            .GetEnabledChannelsAsync(AiChannelTypes.PollingTypes, ct);
        var active = new HashSet<string>(channels.Select(c => c.Id));

        foreach (var ch in channels)
        {
            if (_loops.TryGetValue(ch.Id, out var running) && !running.IsCompleted)
                continue;
            if (_polls.TryGetValue(ch.Id, out var oldCts)) oldCts.Cancel();
            _polls[ch.Id] = new CancellationTokenSource();
            var cts = _polls[ch.Id];
            _loops[ch.Id] = Task.Run(() => PollLoopAsync(ch, cts.Token), ct);
            _logger.LogInformation("Starting poll loop for channel {Channel} ({Type})", ch.Id, ch.ChannelType);
        }
        foreach (var id in _polls.Keys.Where(id => !active.Contains(id)).ToList())
        {
            _logger.LogInformation("Stopping poll loop for channel {Channel}", id);
            _polls[id].Cancel();
            _polls.TryRemove(id, out _);
            _loops.TryRemove(id, out _);
            _cursors.TryRemove(id, out _);
        }
    }

    private async Task PollLoopAsync(AiChannel channel, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var channels = scope.ServiceProvider.GetRequiredService<AiChannelService>();
        var cursor = _cursors.GetValueOrDefault(channel.Id, "");
        if (cursor.Length == 0)
        {
            try
            {
                cursor = await channels.GetPollCursorAsync(channel.Id, ct);
                _cursors[channel.Id] = cursor;
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to load poll cursor (channel {Channel})", channel.Id);
            }
        }
        var sessionExpiredLogged = false;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var batch = await channels.PollChannelAsync(channel, cursor, ct);
                if (batch.NewCursor != null && batch.NewCursor != cursor)
                {
                    cursor = batch.NewCursor;
                    _cursors[channel.Id] = cursor;
                    try { await channels.SetPollCursorAsync(channel.Id, cursor, ct); }
                    catch (OperationCanceledException) { return; }
                    catch (Exception ex) { _logger.LogWarning(ex, "Failed to persist poll cursor (channel {Channel})", channel.Id); }
                }
                sessionExpiredLogged = false;
                foreach (var msg in batch.Messages)
                {
                    var m = msg;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await channels.HandleInboundAsync(m, ct);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Inbound handling failed (channel {Channel})", channel.Id);
                        }
                    }, ct);
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (SessionExpiredException ex)
            {
                if (!sessionExpiredLogged)
                {
                    _logger.LogWarning(ex, "iLink session expired (channel {Channel}) — 需要重新扫码登录", channel.Id);
                    sessionExpiredLogged = true;
                }
                try { await Task.Delay(TimeSpan.FromSeconds(60), ct); }
                catch (OperationCanceledException) { break; }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Poll loop error (channel {Channel})", channel.Id);
                try { await Task.Delay(TimeSpan.FromSeconds(5), ct); }
                catch (OperationCanceledException) { break; }
            }
        }
        _logger.LogInformation("Poll loop ended for channel {Channel}", channel.Id);
    }
}
