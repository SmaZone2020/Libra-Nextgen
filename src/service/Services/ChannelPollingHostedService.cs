using System.Collections.Concurrent;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services;

/// <summary>
/// AI 频道轮询后台服务：为每个启用的长轮询型频道（Telegram getUpdates / 微信 iLink getupdates）
/// 跑一条长轮询循环（无需公网回调地址，适配 C2 局域网/内网部署）。
/// 频道停用/删除时自动取消对应循环；iLink 会话过期（-14）时退避重试并提示重新登录。
/// </summary>
public class ChannelPollingHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ChannelPollingHostedService> _logger;
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _polls = new();
    /// <summary>每频道不透明游标（Telegram update_id / iLink get_updates_buf）。</summary>
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

    /// <summary>扫描启用的长轮询频道：新增的启动循环，停用/删除的取消。</summary>
    private async Task ReconcileAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var channels = await scope.ServiceProvider
            .GetRequiredService<AiChannelService>()
            .GetEnabledChannelsAsync(AiChannelTypes.PollingTypes, ct);
        var active = new HashSet<string>(channels.Select(c => c.Id));

        foreach (var ch in channels)
        {
            if (_polls.ContainsKey(ch.Id)) continue;
            _polls[ch.Id] = new CancellationTokenSource();
            _logger.LogInformation("Starting poll loop for channel {Channel} ({Type})", ch.Id, ch.ChannelType);
            _ = Task.Run(() => PollLoopAsync(ch, _polls[ch.Id].Token), ct);
        }
        foreach (var id in _polls.Keys.Where(id => !active.Contains(id)).ToList())
        {
            _logger.LogInformation("Stopping poll loop for channel {Channel}", id);
            _polls[id].Cancel();
            _polls.TryRemove(id, out _);
        }
    }

    private async Task PollLoopAsync(AiChannel channel, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var channels = scope.ServiceProvider.GetRequiredService<AiChannelService>();
        var cursor = _cursors.GetValueOrDefault(channel.Id, "");
        var sessionExpiredLogged = false;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var batch = await channels.PollChannelAsync(channel, cursor, ct);
                cursor = batch.NewCursor ?? cursor;
                _cursors[channel.Id] = cursor;
                sessionExpiredLogged = false;
                foreach (var msg in batch.Messages)
                {
                    await channels.HandleInboundAsync(msg, ct);
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (SessionExpiredException ex)
            {
                // iLink 会话过期：退避重试（管理员重新扫码换 bot_token 后自动恢复）。
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
                // 网络抖动 / token 失效等：记日志后退避重试（长轮询超时本身会自然重来）。
                _logger.LogWarning(ex, "Poll loop error (channel {Channel})", channel.Id);
                try { await Task.Delay(TimeSpan.FromSeconds(5), ct); }
                catch (OperationCanceledException) { break; }
            }
        }
        _logger.LogInformation("Poll loop ended for channel {Channel}", channel.Id);
    }
}
