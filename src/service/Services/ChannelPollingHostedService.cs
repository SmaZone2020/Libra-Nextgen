using System.Collections.Concurrent;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services;

/// <summary>
/// AI 频道轮询后台服务：为每个启用的手写长轮询型频道（微信 iLink getupdates）
/// 跑一条长轮询循环（无需公网回调地址，适配 C2 局域网/内网部署）。
/// Telegram 已改用 Telegram.Bot 库自带接收（TelegramBotHostedService），不在此列。
/// - 游标（iLink get_updates_buf）持久化到 MongoDB，服务重启不重放；
/// - 频道停用/删除时自动取消对应循环；循环异常退出后由 Reconcile 自动拉起（死循环自愈）；
/// - iLink 会话过期（-14）时退避重试并提示重新登录。
/// </summary>
public class ChannelPollingHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ChannelPollingHostedService> _logger;
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _polls = new();
    /// <summary>每频道轮询任务（用于检测循环意外退出并自动拉起）。</summary>
    private readonly ConcurrentDictionary<string, Task> _loops = new();
    /// <summary>每频道不透明游标（内存缓存，启动时从 Mongo 恢复）。</summary>
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
    /// 扫描启用的长轮询频道：新增/意外退出的启动循环，停用/删除的取消。
    /// 以 _loops 的 Task 完成状态为准（_polls 里的 cts 可能在循环退出后残留）。
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
            // 已有存活循环 → 跳过；循环已退出（任务完成）→ 清理后重新拉起。
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
        // 游标：内存优先，其次 Mongo 持久化值（服务重启后不重放）。
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
                    // 持久化游标：Telegram 确认语义依赖 offset 单调推进，
                    // 崩溃/重启后从库恢复，避免重放。
                    try { await channels.SetPollCursorAsync(channel.Id, cursor, ct); }
                    catch (OperationCanceledException) { return; }
                    catch (Exception ex) { _logger.LogWarning(ex, "Failed to persist poll cursor (channel {Channel})", channel.Id); }
                }
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
