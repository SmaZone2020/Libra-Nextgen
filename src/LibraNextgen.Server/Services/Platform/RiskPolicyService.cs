using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services.Platform;

/// <summary>
/// Loads and caches the admin-configured risk policy. Falls back to the
/// built-in defaults for any action key not explicitly overridden.
/// </summary>
public class RiskPolicyService
{
    private readonly IStore<RiskPolicy> _store;
    private volatile Dictionary<string, RiskLevel> _cache = RiskActions.DefaultMappings();

    public RiskPolicyService(IStore<RiskPolicy> store)
    {
        _store = store;
    }

    public async Task LoadAsync(CancellationToken ct = default)
    {
        var policy = await _store.FirstOrDefaultAsync(_ => true, ct);
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
        var policy = await _store.FirstOrDefaultAsync(_ => true, ct);

        if (policy == null)
        {
            try
            {
                await _store.InsertAsync(new RiskPolicy { Mappings = sanitized }, ct);
            }
            catch (DuplicateKeyException)
            {
                // Concurrent first-save: fall through to the update path.
                var concurrent = await _store.FirstOrDefaultAsync(_ => true, ct);
                if (concurrent != null)
                    await _store.UpdateByIdAsync(concurrent.Id,
                        new[] { new FieldUpdate(nameof(RiskPolicy.Mappings), sanitized) }, ct);
            }
        }
        else
        {
            await _store.UpdateByIdAsync(policy.Id,
                new[] { new FieldUpdate(nameof(RiskPolicy.Mappings), sanitized) }, ct);
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
