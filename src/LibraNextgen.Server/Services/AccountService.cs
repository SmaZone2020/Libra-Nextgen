using System.Security.Cryptography;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

public class AccountService
{
    private readonly Repository<User> _users;
    private readonly JwtSettings _jwtSettings;

    public AccountService(Repository<User> users, JwtSettings jwtSettings)
    {
        _users = users;
        _jwtSettings = jwtSettings;
    }

    /// <summary>Effective permissions for a user — Admins always have full access.</summary>
    public async Task<UserPermissions> GetEffectivePermissionsAsync(string userId, UserRole role)
    {
        if (role == UserRole.Admin)
            return new UserPermissions { FullAccess = true };

        var user = await _users.GetByIdAsync(userId);
        return user?.Permissions ?? new UserPermissions { FullAccess = false };
    }

    /// <summary>Record that the current user accepted the authorized-use agreement.</summary>
    public async Task AcceptAgreementAsync(string userId)
    {
        var update = Builders<User>.Update.Set(u => u.AgreedAt, DateTime.UtcNow);
        await _users.UpdateAsync(userId, update);
    }

    /// <summary>The agreement timestamp, or null if the user has not accepted yet.</summary>
    public async Task<DateTime?> GetAgreedAtAsync(string userId)
    {
        var user = await _users.GetByIdAsync(userId);
        return user?.AgreedAt;
    }

    public async Task<List<AccountListItem>> ListAsync()
    {
        var users = await _users.FindAsync(_ => true);
        return users.Select(u => new AccountListItem
        {
            Id = u.Id,
            Username = u.Username,
            Role = u.Role.ToString(),
            IsActive = u.IsActive,
            IsInitial = u.IsInitial,
            CreatedAt = u.CreatedAt,
            LastLogin = u.LastLogin,
            Permissions = u.Permissions,
        }).ToList();
    }

    public async Task<AccountListItem> CreateAsync(CreateAccountRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Length < 2)
            throw new ArgumentException("Username must be at least 2 characters.");

        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 6)
            throw new ArgumentException("Password must be at least 6 characters.");

        if (await _users.ExistsAsync(u => u.Username == request.Username))
            throw new ArgumentException("Username already exists.");

        var user = new User
        {
            Username = request.Username,
            PasswordHash = HashPassword(request.Password),
            Role = request.Role,
            IsActive = true,
            IsInitial = false,
            CreatedAt = DateTime.UtcNow,
            Permissions = request.Permissions ?? new UserPermissions { FullAccess = true },
        };
        await _users.InsertAsync(user);

        return new AccountListItem
        {
            Id = user.Id,
            Username = user.Username,
            Role = user.Role.ToString(),
            IsActive = user.IsActive,
            IsInitial = user.IsInitial,
            CreatedAt = user.CreatedAt,
            LastLogin = null,
            Permissions = user.Permissions,
        };
    }

    public async Task UpdateAsync(string id, UpdateAccountRequest request)
    {
        var user = await _users.GetByIdAsync(id)
            ?? throw new KeyNotFoundException("Account not found.");

        if (user.IsInitial)
            throw new InvalidOperationException("Cannot edit the initial admin account.");

        var updates = new List<UpdateDefinition<User>>();

        if (request.Username != null)
        {
            if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Length < 2)
                throw new ArgumentException("Username must be at least 2 characters.");
            if (await _users.ExistsAsync(u => u.Username == request.Username && u.Id != id))
                throw new ArgumentException("Username already exists.");
            updates.Add(Builders<User>.Update.Set(u => u.Username, request.Username));
        }

        if (request.Role.HasValue)
            updates.Add(Builders<User>.Update.Set(u => u.Role, request.Role.Value));

        if (request.IsActive.HasValue)
            updates.Add(Builders<User>.Update.Set(u => u.IsActive, request.IsActive.Value));

        if (request.Permissions != null)
            updates.Add(Builders<User>.Update.Set(u => u.Permissions, request.Permissions));

        if (updates.Count > 0)
            await _users.UpdateAsync(id, Builders<User>.Update.Combine(updates));
    }

    public async Task DeleteAsync(string id, string currentUserId)
    {
        if (id == currentUserId)
            throw new InvalidOperationException("Cannot delete your own account.");

        var user = await _users.GetByIdAsync(id)
            ?? throw new KeyNotFoundException("Account not found.");

        if (user.IsInitial)
            throw new InvalidOperationException("Cannot delete the initial admin account.");

        var remainingAdmins = await _users.CountAsync(u => u.Role == UserRole.Admin && u.Id != id && u.IsActive);
        if (user.Role == UserRole.Admin && remainingAdmins == 0)
            throw new InvalidOperationException("Cannot delete the last admin account.");

        await _users.DeleteAsync(id);
    }

    public async Task ChangePasswordAsync(string userId, string currentPassword, string newPassword)
    {
        if (string.IsNullOrWhiteSpace(newPassword) || newPassword.Length < 6)
            throw new ArgumentException("Password must be at least 6 characters.");

        var user = await _users.GetByIdAsync(userId)
            ?? throw new KeyNotFoundException("Account not found.");

        if (!VerifyPassword(currentPassword, user.PasswordHash))
            throw new UnauthorizedAccessException("Current password is incorrect.");

        var update = Builders<User>.Update.Set(u => u.PasswordHash, HashPassword(newPassword));
        await _users.UpdateAsync(userId, update);
    }

    public async Task<bool> IsInitialAccountAsync(string userId)
    {
        var user = await _users.GetByIdAsync(userId);
        return user?.IsInitial ?? false;
    }

    private static string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 600_000, HashAlgorithmName.SHA256, 32);
        var combined = new byte[salt.Length + hash.Length];
        Buffer.BlockCopy(salt, 0, combined, 0, salt.Length);
        Buffer.BlockCopy(hash, 0, combined, salt.Length, hash.Length);
        return Convert.ToBase64String(combined);
    }

    private static bool VerifyPassword(string password, string storedHash)
    {
        var combined = Convert.FromBase64String(storedHash);
        var salt = new byte[16];
        var hash = new byte[32];
        Buffer.BlockCopy(combined, 0, salt, 0, 16);
        Buffer.BlockCopy(combined, 16, hash, 0, 32);
        var computedHash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 600_000, HashAlgorithmName.SHA256, 32);
        return CryptographicOperations.FixedTimeEquals(hash, computedHash);
    }
}
