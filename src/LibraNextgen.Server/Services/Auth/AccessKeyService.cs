using System.Security.Cryptography;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services.Auth;

public class AccessKeyService
{
    private readonly Repository<AccessKey> _repo;

    public AccessKeyService(Repository<AccessKey> repo)
    {
        _repo = repo;
    }

    /// <summary>SHA-256 hash a raw access key. The raw key is never persisted.</summary>
    public static string HashKey(string rawKey) =>
        Convert.ToBase64String(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rawKey)));

    public async Task<(AccessKey Key, string RawKey)> CreateAsync(
        string name, DateTime? expiresAt, string userId, string userName, string role)
    {
        var keyBytes = RandomNumberGenerator.GetBytes(32);
        var rawKey = "lnk_" + Convert.ToBase64String(keyBytes)
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

        var entity = new AccessKey
        {
            Name = name,
            KeyHash = HashKey(rawKey),
            Role = role,
            CreatedByUserId = userId,
            CreatedByUserName = userName,
            ExpiresAt = expiresAt,
        };

        await _repo.InsertAsync(entity);
        return (entity, rawKey);
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
        var hash = HashKey(rawKey);
        var key = await _repo.FirstOrDefaultAsync(k => k.KeyHash == hash && k.IsActive);
        if (key == null) return null;

        if (key.ExpiresAt.HasValue && key.ExpiresAt.Value < DateTime.UtcNow)
            return null;

        var update = Builders<AccessKey>.Update.Set(k => k.LastUsedAt, DateTime.UtcNow);
        await _repo.UpdateAsync(key.Id, update);

        return key;
    }
}
