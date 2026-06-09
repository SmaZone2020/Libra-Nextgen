using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;

namespace LibraNextgen.Common.Protocol;

public static class JwtHelper
{
    public static (string token, DateTime expires) GenerateToken(
        string userId,
        string username,
        string role,
        string privateKeyPem,
        string issuer,
        string audience,
        int expirationMinutes = 120)
    {
        using var rsa = RSA.Create();
        rsa.ImportFromPem(privateKeyPem);
        var credentials = new SigningCredentials(
            new RsaSecurityKey(rsa),
            SecurityAlgorithms.RsaSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId),
            new Claim(ClaimTypes.Name, username),
            new Claim(ClaimTypes.Role, role),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var expires = DateTime.UtcNow.AddMinutes(expirationMinutes);
        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: expires,
            signingCredentials: credentials);

        return (new JwtSecurityTokenHandler().WriteToken(token), expires);
    }

    public static ClaimsPrincipal? ValidateToken(string token, string publicKeyPem, string issuer, string audience)
    {
        using var rsa = RSA.Create();
        rsa.ImportFromPem(publicKeyPem);

        var handler = new JwtSecurityTokenHandler();
        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = issuer,
            ValidAudience = audience,
            IssuerSigningKey = new RsaSecurityKey(rsa),
            ClockSkew = TimeSpan.Zero
        };

        try
        {
            var principal = handler.ValidateToken(token, parameters, out _);
            return principal;
        }
        catch
        {
            return null;
        }
    }

    public static (string publicKey, string privateKey) GenerateRsaKeysForJwt()
    {
        using var rsa = RSA.Create(2048);
        var pub = rsa.ExportSubjectPublicKeyInfoPem();
        var priv = rsa.ExportPkcs8PrivateKeyPem();
        return (pub, priv);
    }
}
