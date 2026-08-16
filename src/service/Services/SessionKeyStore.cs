using System.Collections.Concurrent;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Holds the per-agent AES-256 session keys established at registration.
/// Keys are ephemeral (in-memory only) and rotate whenever an agent re-registers.
/// </summary>
public class SessionKeyStore
{
    private readonly ConcurrentDictionary<string, byte[]> _keys = new();

    public void Set(string agentId, byte[] key) => _keys[agentId] = key;

    public bool TryGet(string agentId, out byte[]? key) => _keys.TryGetValue(agentId, out key);

    public void Remove(string agentId) => _keys.TryRemove(agentId, out _);
}
