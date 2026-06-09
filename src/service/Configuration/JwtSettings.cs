using System.Security.Cryptography;

namespace LibraNextgen.Service.Configuration;

public class JwtSettings
{
    public const string SectionName = "Jwt";
    public string Issuer { get; set; } = "Libra-Nextgen";
    public string Audience { get; set; } = "Libra-Console";
    public string? PublicKey { get; set; }
    public string? PrivateKey { get; set; }
    public int TokenExpirationMinutes { get; set; } = 120;
    public int RefreshTokenExpirationDays { get; set; } = 7;

    public void EnsureKeys()
    {
        if (!string.IsNullOrEmpty(PublicKey) && !string.IsNullOrEmpty(PrivateKey))
            return;

        using var rsa = RSA.Create(2048);
        PublicKey = rsa.ExportSubjectPublicKeyInfoPem();
        PrivateKey = rsa.ExportPkcs8PrivateKeyPem();
    }
}
