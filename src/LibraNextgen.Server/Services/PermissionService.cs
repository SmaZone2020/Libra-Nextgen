using System.Collections.Concurrent;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Caches per-user permissions and evaluates action-level access. Admins always
/// have full access; Operators are restricted to their configured allowed pages
/// and actions.
/// </summary>
public class PermissionService
{
    private readonly ConcurrentDictionary<string, UserPermissions> _cache = new();
    private readonly IMongoCollection<User> _users;

    public PermissionService(MongoDbContext context)
    {
        _users = context.GetCollection<User>("users");
    }

    public UserPermissions GetPermissions(string userId)
    {
        if (_cache.TryGetValue(userId, out var cached))
            return cached;

        var user = _users.Find(Builders<User>.Filter.Eq(u => u.Id, userId)).FirstOrDefault();
        var permissions = user?.Permissions ?? new UserPermissions { FullAccess = false };

        _cache[userId] = permissions;
        return permissions;
    }

    /// <summary>True if the user may perform the given action key.</summary>
    public bool IsAllowed(string userId, string? actionKey)
    {
        if (string.IsNullOrEmpty(actionKey))
            return true;

        var permissions = GetPermissions(userId);
        if (permissions.FullAccess)
            return true;

        return permissions.AllowedActions.Contains(actionKey);
    }

    public void Invalidate(string userId) => _cache.TryRemove(userId, out _);
}
