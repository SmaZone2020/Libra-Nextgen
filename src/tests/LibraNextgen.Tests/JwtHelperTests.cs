using System.Security.Claims;
using System.Security.Cryptography;
using LibraNextgen.Common.Protocol;
using Xunit;

namespace LibraNextgen.Tests;

public class JwtHelperTests
{
    private const string Issuer = "Libra-Nextgen";
    private const string Audience = "Libra-Console";

    [Fact]
    public void GenerateThenValidate_ReturnsPrincipal()
    {
        using var rsa = RSA.Create(2048);
        var (token, _) = JwtHelper.GenerateToken("user-1", "alice", "Admin", rsa, Issuer, Audience);

        var principal = JwtHelper.ValidateToken(token, rsa, Issuer, Audience);
        Assert.NotNull(principal);
        Assert.Equal("alice", principal!.Identity!.Name);
        Assert.Equal("user-1", principal.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        Assert.Equal("Admin", principal.FindFirst(ClaimTypes.Role)!.Value);
    }

    [Fact]
    public void Validate_WrongSigningKey_ReturnsNull()
    {
        using var rsa = RSA.Create(2048);
        using var otherRsa = RSA.Create(2048);
        var (token, _) = JwtHelper.GenerateToken("user-1", "alice", "Admin", rsa, Issuer, Audience);

        Assert.Null(JwtHelper.ValidateToken(token, otherRsa, Issuer, Audience));
    }

    [Fact]
    public void Validate_ExpiredToken_ReturnsNull()
    {
        using var rsa = RSA.Create(2048);
        var (token, _) = JwtHelper.GenerateToken("user-1", "alice", "Admin", rsa, Issuer, Audience, expirationMinutes: -1);

        Assert.Null(JwtHelper.ValidateToken(token, rsa, Issuer, Audience));
    }
}
