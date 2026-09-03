using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Loads and caches the admin-configured risk policy. Falls back to the
/// built-in defaults for any action key not explicitly overridden.
/// </summary>
public class RiskPolicyService
{
    private readonly IMongoCollection<RiskPolicy> _collection;
    private volatile Dictionary<string, RiskLevel> _cache = RiskActions.DefaultMappings();

    public RiskPolicyService(MongoDbContext context)
    {
        _collection = context.GetCollection<RiskPolicy>("risk_policy");
    }

    public async Task LoadAsync(CancellationToken ct = default)
    {
        var policy = await _collection.Find(FilterDefinition<RiskPolicy>.Empty).FirstOrDefaultAsync(ct);
        if (policy != null)
        {
            _cache = Merge(policy.Mappings);
        }
    }

    public RiskLevel GetRisk(string? actionKey)
    {
        if (string.IsNullOrEmpty(actionKey))
            return RiskLevel.Normal;
        return _cache.TryGetValue(actionKey, out var level) ? level : RiskLevel.Normal;
    }

    public Dictionary<string, RiskLevel> GetMappings() => new(_cache);

    public async Task SaveAsync(Dictionary<string, RiskLevel> mappings, CancellationToken ct = default)
    {
        var sanitized = Merge(mappings);
        var policy = await _collection.Find(FilterDefinition<RiskPolicy>.Empty).FirstOrDefaultAsync(ct);

        if (policy == null)
        {
            await _collection.InsertOneAsync(new RiskPolicy { Mappings = sanitized }, cancellationToken: ct);
        }
        else
        {
            await _collection.UpdateOneAsync(
                Builders<RiskPolicy>.Filter.Eq(p => p.Id, policy.Id),
                Builders<RiskPolicy>.Update.Set(p => p.Mappings, sanitized),
                cancellationToken: ct);
        }

        _cache = sanitized;
    }

    /// <summary>Overlay stored mappings on top of the defaults so newly added
    /// actions always have a sensible value.</summary>
    private static Dictionary<string, RiskLevel> Merge(Dictionary<string, RiskLevel> stored)
    {
        var merged = RiskActions.DefaultMappings();
        foreach (var kv in stored)
            merged[kv.Key] = kv.Value;
        return merged;
    }
}
