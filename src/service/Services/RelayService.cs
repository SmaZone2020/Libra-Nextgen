using System.Text.Json;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Service.Services;

public class RelayService
{
    private readonly ConnectionManager _wsManager;
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(30);

    public RelayService(ConnectionManager wsManager)
    {
        _wsManager = wsManager;
    }

    public async Task<WebSocketMessage?> RelayAndWaitAsync(
        string agentId, string messageType, object? data,
        CancellationToken ct, TimeSpan? timeout = null)
    {
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
            return await tcs.Task.WaitAsync(timeout ?? DefaultTimeout, ct);
        }
        catch (TimeoutException)
        {
            return null;
        }
    }
}
