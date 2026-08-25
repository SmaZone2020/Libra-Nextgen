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
    private readonly IMongoCollection<SessionTokenDoc> _tokenCollection;

    public SessionKeyStore(MongoDbContext context)
    {
        _collection = context.GetCollection<SessionKey>("session_keys");
        _tokenCollection = context.GetCollection<SessionTokenDoc>("session_tokens");
    }

    /// <summary>Load all persisted keys and tokens into the in-memory cache (called at startup).</summary>
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
        var tokens = await _tokenCollection.Find(FilterDefinition<SessionTokenDoc>.Empty).ToListAsync(ct);
        foreach (var t in tokens)
        {
            if (!string.IsNullOrEmpty(t.Token) && !string.IsNullOrEmpty(t.AgentId))
                _tokens[t.Token] = t.AgentId;
        }
    }

    public void Set(string agentId, byte[] key)
    {
        _cache[agentId] = key;

        // 同步持久化：fire-and-forget 在进程被杀/快速重启时会丢写，导致
        // 服务端重启后 key 失配（agent 用新 key、服务端加载旧 key）→
        // 心跳/SSE 永久解密失败死循环。注册路径可接受一次同步等待。
        var doc = new SessionKey { AgentId = agentId, Key = Convert.ToBase64String(key) };
        try
        {
            _collection.ReplaceOneAsync(
                Builders<SessionKey>.Filter.Eq(s => s.AgentId, agentId),
                doc,
                new ReplaceOptions { IsUpsert = true }).GetAwaiter().GetResult();
        }
        catch
        {
            // 持久化失败不阻断注册（内存 key 仍是权威），但下个服务端
            // 重启会失配并触发 agent 自愈重注册。
        }
    }

    public bool TryGet(string agentId, out byte[]? key) => _cache.TryGetValue(agentId, out key);

    /// <summary>Issue a fresh opaque channel token for an agent session（持久化，重启不丢）。</summary>
    public string IssueToken(string agentId)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        _tokens[token] = agentId;
        try
        {
            _tokenCollection.ReplaceOneAsync(
                Builders<SessionTokenDoc>.Filter.Eq(t => t.Token, token),
                new SessionTokenDoc { Token = token, AgentId = agentId },
                new ReplaceOptions { IsUpsert = true }).GetAwaiter().GetResult();
        }
        catch
        {
            // 同上：持久化失败不阻断，重启后 agent 自愈重注册。
        }
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

/// <summary>持久化的会话 token → agent 映射（服务重启后 agent 无需重注册）。</summary>
public class SessionTokenDoc
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Token { get; set; } = string.Empty;
    public string AgentId { get; set; } = string.Empty;
}
