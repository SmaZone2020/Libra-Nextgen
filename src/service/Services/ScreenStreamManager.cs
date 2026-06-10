using System.Collections.Concurrent;
using System.Threading.Channels;

namespace LibraNextgen.Service.Services;

public static class ScreenStreamManager
{
    private static readonly ConcurrentDictionary<string, StreamState> _streams = new();

    private sealed class StreamState
    {
        private readonly object _lock = new();
        private readonly List<Channel<string>> _channels = [];

        public Channel<string> Add()
        {
            var ch = Channel.CreateBounded<string>(new BoundedChannelOptions(60)
            {
                FullMode = BoundedChannelFullMode.DropOldest
            });
            lock (_lock) { _channels.Add(ch); }
            return ch;
        }

        public bool Remove(Channel<string> ch)
        {
            lock (_lock)
            {
                _channels.Remove(ch);
                ch.Writer.TryComplete();
                return _channels.Count == 0;
            }
        }

        public void Push(string json)
        {
            lock (_lock)
            {
                foreach (var ch in _channels)
                    ch.Writer.TryWrite(json);
            }
        }
    }

    public static Channel<string> Subscribe(string agentId)
    {
        var state = _streams.GetOrAdd(agentId, _ => new StreamState());
        return state.Add();
    }

    public static void Unsubscribe(string agentId, Channel<string> channel)
    {
        if (!_streams.TryGetValue(agentId, out var state)) return;
        bool empty = state.Remove(channel);
        if (empty)
            _streams.TryRemove(agentId, out _);
    }

    public static void TryPushFrame(string agentId, string json)
    {
        if (_streams.TryGetValue(agentId, out var state))
            state.Push(json);
    }
}
