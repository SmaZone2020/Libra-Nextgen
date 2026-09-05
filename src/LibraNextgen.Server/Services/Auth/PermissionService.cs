using System.Collections.Concurrent;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services.Auth;

/// <summary>
/// Caches per-user permissions and evaluates action-level access. Admins always
/// have full access; Operators are restricted to their configured allowed pages
/// and actions. The public API stays synchronous (it is called from middleware
/// and controllers on the hot path); the first cache miss per user performs a
/// blocking store read, which is safe in ASP.NET Core (no sync context) and
/// happens at most once per user per process.
/// </summary>
public class PermissionService
{
    private readonly ConcurrentDictionary<string, UserPermissions> _cache = new();
    private readonly IStore<User> _users;

    public PermissionService(IStore<User> users)
    {
        _users = users;
    }

    public UserPermissions GetPermissions(string userId)
    {
        if (_cache.TryGetValue(userId, out var cached))
            return cached;

        var user = _users.GetByIdAsync(userId).GetAwaiter().GetResult();
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
