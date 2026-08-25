using System.Text.Json;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Service.Services;

public class RelayService
{
    private readonly ConnectionManager _wsManager;
    private readonly AgentService _agentService;
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(30);
    /// <summary>等待 agent 实时通道（WS）上线的上限（心跳 10s，两个周期内应连上）。</summary>
    private static readonly TimeSpan WsBringUpTimeout = TimeSpan.FromSeconds(25);

    public RelayService(ConnectionManager wsManager, AgentService agentService)
    {
        _wsManager = wsManager;
        _agentService = agentService;
    }

    public async Task<WebSocketMessage?> RelayAndWaitAsync(
        string agentId, string messageType, object? data,
        CancellationToken ct, TimeSpan? timeout = null)
    {
        var total = timeout ?? DefaultTimeout;
        var started = DateTime.UtcNow;

        // WS 按需：agent 不再常驻连接。若实时通道未在线，先置 WsNeeded=true
        // （下个心跳 agent 会建立 WS），并等待其上线；超时则按无响应处理。
        if (!_wsManager.IsAgentConnected(agentId))
        {
            await _agentService.SetWsNeededAsync(agentId, true, ct);
            var deadline = started.Add(WsBringUpTimeout);
            while (!_wsManager.IsAgentConnected(agentId) && DateTime.UtcNow < deadline)
            {
                await Task.Delay(500, ct);
            }
        }

        // 剩余超时 = 总超时 - 拉起 WS 的等待时间
        var elapsed = DateTime.UtcNow - started;
        var effective = total - elapsed;
        if (effective <= TimeSpan.Zero)
            effective = TimeSpan.FromSeconds(5);

        var requestId = Guid.NewGuid().ToString("N");
        var msg = new WebSocketMessage
        {
            Type = messageType,
            Channel = agentId,
            Data = data != null ? JsonSerializer.SerializeToElement(data) : null,
            RequestId = requestId
        };

        var tcs = _wsManager.RegisterPendingRequest(requestId);
        await _wsManager.RelayToAgentAsync(agentId, msg, ct);

        try
        {
            return await tcs.Task.WaitAsync(effective, ct);
        }
        catch (TimeoutException)
        {
            return null;
        }
        catch (OperationCanceledException)
        {
            // 请求取消或 30s 自动清理：与超时等价，按无响应处理
            return null;
        }
    }
}
