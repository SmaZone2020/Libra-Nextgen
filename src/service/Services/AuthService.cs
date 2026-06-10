using System.Security.Cryptography;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

public class AuthService
{
    private readonly Repository<User> _users;
    private readonly JwtSettings _jwtSettings;

    public AuthService(Repository<User> users, JwtSettings jwtSettings)
    {
        _users = users;
        _jwtSettings = jwtSettings;
    }

    public async Task<LoginResponse?> LoginAsync(LoginRequest request, string ipAddress)
    {
        var user = await _users.FirstOrDefaultAsync(u => u.Username == request.Username);
        if (user == null || !user.IsActive)
            return null;

        if (!VerifyPassword(request.Password, user.PasswordHash))
            return null;

        var (token, expires) = JwtHelper.GenerateToken(
            user.Id, user.Username, user.Role.ToString(),
            _jwtSettings.Rsa, _jwtSettings.Issuer, _jwtSettings.Audience,
            _jwtSettings.TokenExpirationMinutes);

        var refreshToken = GenerateRefreshToken();

        var update = Builders<User>.Update.Set(u => u.LastLogin, DateTime.UtcNow);
        await _users.UpdateAsync(user.Id, update);

        return new LoginResponse
        {
            Token = token,
            RefreshToken = refreshToken,
            ExpiresAt = expires,
            Username = user.Username,
            Role = user.Role
        };
    }

    public async Task<bool> NeedsSetupAsync()
    {
        return !await _users.ExistsAsync(_ => true);
    }

    public async Task<LoginResponse> SetupAsync(string username, string password, string ipAddress)
    {
        if (await _users.ExistsAsync(_ => true))
            throw new InvalidOperationException("Setup has already been completed.");

        var user = new User
        {
            Username = username,
            PasswordHash = HashPassword(password),
            Role = UserRole.Admin,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        await _users.InsertAsync(user);

        var (token, expires) = JwtHelper.GenerateToken(
            user.Id, user.Username, user.Role.ToString(),
            _jwtSettings.Rsa, _jwtSettings.Issuer, _jwtSettings.Audience,
            _jwtSettings.TokenExpirationMinutes);

        var refreshToken = GenerateRefreshToken();

        return new LoginResponse
        {
            Token = token,
            RefreshToken = refreshToken,
            ExpiresAt = expires,
            Username = user.Username,
            Role = user.Role
        };
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

    private static string GenerateRefreshToken()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    }
}
