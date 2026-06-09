using LibraNextgen.Common.Profiles;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Profiles;

namespace LibraNextgen.Service.Services;

public class ProfileService
{
    private readonly Repository<MalleableProfileConfig> _profiles;

    public ProfileService(Repository<MalleableProfileConfig> profiles)
    {
        _profiles = profiles;
    }

    public IMalleableProfile GetActiveProfile()
    {
        // In future: load from DB. For now, always return default.
        return new DefaultProfile();
    }

    public async Task<List<MalleableProfileConfig>> GetAllAsync(CancellationToken ct = default)
    {
        return await _profiles.FindAsync(p => true, ct);
    }

    public async Task<MalleableProfileConfig?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        return await _profiles.GetByIdAsync(id, ct);
    }

    public async Task<MalleableProfileConfig> CreateAsync(MalleableProfileConfig config, string createdBy, CancellationToken ct = default)
    {
        config.Id = Guid.NewGuid().ToString("N");
        config.CreatedAt = DateTime.UtcNow;
        config.CreatedBy = createdBy;
        await _profiles.InsertAsync(config, ct);
        return config;
    }

    public async Task<bool> ActivateAsync(string id, CancellationToken ct = default)
    {
        var profile = await _profiles.GetByIdAsync(id, ct);
        if (profile == null) return false;

        // Deactivate all others
        var all = await _profiles.FindAsync(p => true, ct);
        foreach (var p in all)
        {
            p.IsActive = p.Id == id;
            await _profiles.UpdateAsync(p.Id,
                MongoDB.Driver.Builders<MalleableProfileConfig>.Update.Set(x => x.IsActive, p.IsActive), ct);
        }
        return true;
    }

    public async Task<long> DeleteAsync(string id, CancellationToken ct = default)
    {
        return await _profiles.DeleteAsync(id, ct);
    }
}
