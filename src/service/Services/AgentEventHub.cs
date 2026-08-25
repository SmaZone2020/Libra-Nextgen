using System.Collections.Concurrent;
using System.Threading.Channels;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Agent 事件推送中心（SSE 任务通道）：
/// agent 建立 SSE 长连接后在此订阅，任务/wsNeeded 变化时由服务端主动推送，
/// 替代心跳轮询。Channel 有界 + DropWrite：连接慢时丢弃事件，心跳兜底补偿。
/// </summary>
public class AgentEventHub
{
    private const int ChannelCapacity = 64;
    private readonly ConcurrentDictionary<string, Channel<AgentPushEvent>> _channels = new();

    public Channel<AgentPushEvent>? Subscribe(string agentId) =>
        _channels.GetOrAdd(agentId, _ =>
            Channel.CreateBounded<AgentPushEvent>(new BoundedChannelOptions(ChannelCapacity)
            {
                FullMode = BoundedChannelFullMode.DropWrite,
                SingleReader = true,
                SingleWriter = false,
            }));

    public void Unsubscribe(string agentId) => _channels.TryRemove(agentId, out _);

    /// <summary>向 agent 的 SSE 通道推送一个事件（无订阅者时静默丢弃，心跳兜底）。</summary>
    public void Push(string agentId, string op, object? data)
    {
        if (_channels.TryGetValue(agentId, out var ch))
            ch.Writer.TryWrite(new AgentPushEvent(op, data));
    }
}

public record AgentPushEvent(string Op, object? Data);
