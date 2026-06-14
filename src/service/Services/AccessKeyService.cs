using System.Security.Cryptography;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

public class AccessKeyService
{
    private readonly Repository<AccessKey> _repo;

    public AccessKeyService(Repository<AccessKey> repo)
    {
        _repo = repo;
    }

    public async Task<AccessKey> CreateAsync(string name, DateTime? expiresAt, string userId, string userName)
    {
        var keyBytes = RandomNumberGenerator.GetBytes(32);
        var rawKey = "lnk_" + Convert.ToBase64String(keyBytes)
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

        var entity = new AccessKey
        {
            Name = name,
            Key = rawKey,
            CreatedByUserId = userId,
            CreatedByUserName = userName,
            ExpiresAt = expiresAt,
        };

        await _repo.InsertAsync(entity);
        return entity;
    }

    public async Task<List<AccessKey>> ListAsync(string? userId, bool isAdmin)
    {
        if (isAdmin)
            return await _repo.GetAllAsync();

        return await _repo.FindAsync(k => k.CreatedByUserId == userId && k.IsActive);
    }

    public async Task<bool> DeleteAsync(string id, string userId, bool isAdmin)
    {
        var key = await _repo.GetByIdAsync(id);
        if (key == null) return false;
        if (!isAdmin && key.CreatedByUserId != userId) return false;

        await _repo.DeleteAsync(id);
        return true;
    }

    public async Task<AccessKey?> ValidateAsync(string rawKey)
    {
        var key = await _repo.FirstOrDefaultAsync(k => k.Key == rawKey && k.IsActive);
        if (key == null) return null;

        if (key.ExpiresAt.HasValue && key.ExpiresAt.Value < DateTime.UtcNow)
            return null;

        var update = Builders<AccessKey>.Update.Set(k => k.LastUsedAt, DateTime.UtcNow);
        await _repo.UpdateAsync(key.Id, update);

        return key;
    }
}
