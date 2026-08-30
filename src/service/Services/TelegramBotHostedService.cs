using System.Collections.Concurrent;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Telegram 长轮询后台服务：为每个启用的 Telegram 频道启动 Telegram.Bot 库自带的
/// StartReceiving（库内部管理 getUpdates offset，无需公网回调）。
/// 频道停用/删除时自动停止；接收循环意外终止后由 Reconcile 自动拉起。
/// 入站消息 → AiChannelService 统一管线；审批按钮回调 → AiChannelService.HandleCallbackAsync。
/// </summary>
public class TelegramBotHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TelegramBotHostedService> _logger;
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _receivers = new();

    public TelegramBotHostedService(IServiceScopeFactory scopeFactory, ILogger<TelegramBotHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Telegram bot hosting service started.");
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
                _logger.LogWarning(ex, "Telegram bot reconcile failed.");
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
        }
        foreach (var cts in _receivers.Values) cts.Cancel();
    }

    private async Task ReconcileAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var channels = await scope.ServiceProvider
            .GetRequiredService<AiChannelService>()
            .GetEnabledChannelsAsync(new[] { AiChannelTypes.Telegram }, ct);
        var active = new HashSet<string>(channels.Select(c => c.Id));

        foreach (var ch in channels)
        {
            if (_receivers.ContainsKey(ch.Id)) continue;
            var cts = new CancellationTokenSource();
            _receivers[ch.Id] = cts;
            _logger.LogInformation("Starting Telegram receiver for channel {Channel}", ch.Id);
            _ = Task.Run(() => RunReceiverAsync(ch, cts.Token), ct);
        }
        foreach (var id in _receivers.Keys.Where(id => !active.Contains(id)).ToList())
        {
            _logger.LogInformation("Stopping Telegram receiver for channel {Channel}", id);
            _receivers[id].Cancel();
            _receivers.TryRemove(id, out _);
        }
    }

    private async Task RunReceiverAsync(AiChannel channel, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var adapter = scope.ServiceProvider.GetRequiredService<TelegramChannelAdapter>();
        var channels = scope.ServiceProvider.GetRequiredService<AiChannelService>();
        try
        {
            await adapter.StartReceivingAsync(
                channel,
                onInbound: channels.HandleInboundAsync,
                onCallback: channels.HandleCallbackAsync,
                ct);
        }
        catch (OperationCanceledException)
        {
            // 正常停止。
        }
        catch (Exception ex)
        {
            // StartReceiving 内部异常不会让 Task 退出（库会持续重连），
            // 这里兜底记录；循环意外退出时由 Reconcile 重启。
            _logger.LogWarning(ex, "Telegram receiver stopped unexpectedly (channel {Channel})", channel.Id);
        }
        _logger.LogInformation("Telegram receiver ended (channel {Channel})", channel.Id);
    }
}
