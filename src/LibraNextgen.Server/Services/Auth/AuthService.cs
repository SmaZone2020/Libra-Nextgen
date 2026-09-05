using System.Security.Cryptography;
using System.Text;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services.Auth;

public class AuthService
{
    private readonly IStore<User> _users;
    private readonly AccessKeyService _accessKeys;
    private readonly JwtSettings _jwtSettings;

    public AuthService(IStore<User> users, AccessKeyService accessKeys, JwtSettings jwtSettings)
    {
        _users = users;
        _accessKeys = accessKeys;
        _jwtSettings = jwtSettings;
    }

    /// <summary>
    /// Exchange an access key (lnk_*) for a short-lived console JWT. Lets a
    /// remote mesh hub authenticate to this server without an account
    /// password. No refresh token is issued: the key stays the credential of
    /// record and the hub simply re-exchanges it when the JWT nears expiry.
    /// </summary>
    public async Task<LoginResponse?> ExchangeAccessKeyAsync(string rawKey)
    {
        if (string.IsNullOrWhiteSpace(rawKey)) return null;

        var key = await _accessKeys.ValidateAsync(rawKey);
        if (key == null) return null;

        var role = Enum.TryParse<UserRole>(key.Role, ignoreCase: true, out var parsed)
            ? parsed
            : UserRole.Operator;

        var (token, expires) = JwtHelper.GenerateToken(
            key.Id, key.Name, key.Role,
            _jwtSettings.Rsa, _jwtSettings.Issuer, _jwtSettings.Audience,
            _jwtSettings.TokenExpirationMinutes);

        return new LoginResponse
        {
            Token = token,
            ExpiresAt = expires,
            Username = key.Name,
            Role = role,
        };
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

        await _users.UpdateByIdAsync(user.Id, new[]
        {
            new FieldUpdate(nameof(User.LastLogin), DateTime.UtcNow),
            new FieldUpdate(nameof(User.RefreshTokenHash), HashRefreshToken(refreshToken)),
            new FieldUpdate(nameof(User.RefreshTokenExpiresAt), DateTime.UtcNow.AddDays(_jwtSettings.RefreshTokenExpirationDays)),
        });

        return new LoginResponse
        {
            Token = token,
            RefreshToken = refreshToken,
            ExpiresAt = expires,
            Username = user.Username,
            Role = user.Role
        };
    }

    /// <summary>
    /// Exchange a refresh token for a new JWT + rotated refresh token.
    /// </summary>
    public async Task<LoginResponse?> RefreshAsync(string refreshToken)
    {
        if (string.IsNullOrWhiteSpace(refreshToken))
            return null;

        var hash = HashRefreshToken(refreshToken);
        var user = await _users.FirstOrDefaultAsync(u => u.RefreshTokenHash == hash && u.IsActive);
        if (user == null)
            return null;

        if (user.RefreshTokenExpiresAt is null || user.RefreshTokenExpiresAt < DateTime.UtcNow)
            return null;

        var (token, expires) = JwtHelper.GenerateToken(
            user.Id, user.Username, user.Role.ToString(),
            _jwtSettings.Rsa, _jwtSettings.Issuer, _jwtSettings.Audience,
            _jwtSettings.TokenExpirationMinutes);

        var newRefreshToken = GenerateRefreshToken();
        await _users.UpdateByIdAsync(user.Id, new[]
        {
            new FieldUpdate(nameof(User.RefreshTokenHash), HashRefreshToken(newRefreshToken)),
            new FieldUpdate(nameof(User.RefreshTokenExpiresAt), DateTime.UtcNow.AddDays(_jwtSettings.RefreshTokenExpirationDays)),
            new FieldUpdate(nameof(User.LastLogin), DateTime.UtcNow),
        });

        return new LoginResponse
        {
            Token = token,
            RefreshToken = newRefreshToken,
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
        var user = new User
        {
            Id = "initial-admin", // fixed id makes concurrent setup atomic (unique _id)
            Username = username,
            PasswordHash = HashPassword(password),
            Role = UserRole.Admin,
            IsActive = true,
            IsInitial = true,
            CreatedAt = DateTime.UtcNow
        };

        try
        {
            await _users.InsertAsync(user);
        }
        catch (DuplicateKeyException)
        {
            throw new InvalidOperationException("Setup has already been completed.");
        }

        var (token, expires) = JwtHelper.GenerateToken(
            user.Id, user.Username, user.Role.ToString(),
            _jwtSettings.Rsa, _jwtSettings.Issuer, _jwtSettings.Audience,
            _jwtSettings.TokenExpirationMinutes);

        var refreshToken = GenerateRefreshToken();

        await _users.UpdateByIdAsync(user.Id, new[]
        {
            new FieldUpdate(nameof(User.RefreshTokenHash), HashRefreshToken(refreshToken)),
            new FieldUpdate(nameof(User.RefreshTokenExpiresAt), DateTime.UtcNow.AddDays(_jwtSettings.RefreshTokenExpirationDays)),
        });

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

    private static string HashRefreshToken(string token)
    {
        return Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    }
}
