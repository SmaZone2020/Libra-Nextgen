using System.Collections.Concurrent;
using System.Security.Cryptography;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Models;

namespace LibraNextgen.Service.Services.Agents;

/// <summary>
/// Holds per-agent AES-256 session keys with an in-memory cache backed by a
/// persistent store (Mongo or SQLite), so keys survive a server restart. The
/// cache is the authoritative hot path; persistence is best-effort and
/// fire-and-forget (never blocks or throws into the beacon path).
///
/// Also issues opaque per-session channel tokens. The token (not the stable
/// agent id) is what agents send on the wire, so beacon traffic carries no
/// persistent identifier; tokens rotate on every registration.
/// </summary>
public class SessionKeyStore
{
    private readonly ConcurrentDictionary<string, byte[]> _cache = new();
    private readonly ConcurrentDictionary<string, string> _tokens = new(); // token -> agentId
    private readonly IStore<SessionKey> _keys;
    private readonly IStore<SessionTokenDoc> _tokenStore;

    public SessionKeyStore(IStore<SessionKey> keys, IStore<SessionTokenDoc> tokenStore)
    {
        _keys = keys;
        _tokenStore = tokenStore;
    }

    /// <summary>Load all persisted keys and tokens into the in-memory cache (called at startup).</summary>
    public async Task LoadAsync(CancellationToken ct = default)
    {
        foreach (var s in await _keys.GetAllAsync(ct))
        {
            if (string.IsNullOrEmpty(s.Key)) continue;
            try
            {
                _cache[s.AgentId] = Convert.FromBase64String(s.Key);
            }
            catch
            {
                // Ignore malformed persisted entries.
            }
        }

        foreach (var t in await _tokenStore.GetAllAsync(ct))
        {
            if (!string.IsNullOrEmpty(t.Token) && !string.IsNullOrEmpty(t.AgentId))
                _tokens[t.Token] = t.AgentId;
        }
    }

    public void Set(string agentId, byte[] key)
    {
        _cache[agentId] = key;
        _ = PersistKeyAsync(agentId, Convert.ToBase64String(key));
    }

    public bool TryGet(string agentId, out byte[]? key) => _cache.TryGetValue(agentId, out key);

    public string IssueToken(string agentId)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        _tokens[token] = agentId;
        _ = PersistTokenAsync(token, agentId);
        return token;
    }

    /// <summary>Resolve an opaque channel token to its agent id.</summary>
    public bool TryResolveToken(string token, out string? agentId) =>
        _tokens.TryGetValue(token, out agentId);

    public void Remove(string agentId)
    {
        _cache.TryRemove(agentId, out _);
        // Drop any tokens that mapped to this agent.
        foreach (var (token, mapped) in _tokens)
        {
            if (mapped == agentId) _tokens.TryRemove(token, out _);
        }
        _ = RemovePersistedAsync(agentId);
    }

    private async Task PersistKeyAsync(string agentId, string base64Key)
    {
        try
        {
            var existing = await _keys.FirstOrDefaultAsync(s => s.AgentId == agentId);
            if (existing is null)
            {
                await _keys.InsertAsync(new SessionKey { AgentId = agentId, Key = base64Key });
            }
            else if (existing.Key != base64Key)
            {
                await _keys.UpdateByIdAsync(existing.Id,
                    new[] { new FieldUpdate(nameof(SessionKey.Key), base64Key) });
            }
        }
        catch
        {
            // Best-effort persistence; the in-memory cache is authoritative.
        }
    }

    private async Task PersistTokenAsync(string token, string agentId)
    {
        try
        {
            await _tokenStore.InsertAsync(new SessionTokenDoc { Token = token, AgentId = agentId });
            // Rotate: drop the agent's older persisted tokens.
            var stale = await _tokenStore.FindAsync(t => t.AgentId == agentId && t.Token != token);
            foreach (var old in stale)
                await _tokenStore.DeleteAsync(old.Id);
        }
        catch
        {
            // Best-effort persistence; token cache is authoritative.
        }
    }

    private async Task RemovePersistedAsync(string agentId)
    {
        try
        {
            var key = await _keys.FirstOrDefaultAsync(s => s.AgentId == agentId);
            if (key is not null)
                await _keys.DeleteAsync(key.Id);
            foreach (var token in await _tokenStore.FindAsync(t => t.AgentId == agentId))
                await _tokenStore.DeleteAsync(token.Id);
        }
        catch
        {
            // Best-effort cleanup.
        }
    }
}

public class SessionTokenDoc
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Token { get; set; } = string.Empty;
    public string AgentId { get; set; } = string.Empty;
}
