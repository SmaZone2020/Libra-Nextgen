using System.Collections.Concurrent;
using System.Threading.Channels;

namespace LibraNextgen.Service.Services.Agents;

/// <summary>
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

    public void Push(string agentId, string op, object? data)
    {
        if (_channels.TryGetValue(agentId, out var ch))
            ch.Writer.TryWrite(new AgentPushEvent(op, data));
    }
}

public record AgentPushEvent(string Op, object? Data);
