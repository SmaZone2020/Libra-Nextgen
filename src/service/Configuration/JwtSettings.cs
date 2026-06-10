using System.Security.Cryptography;

namespace LibraNextgen.Service.Configuration;

public class JwtSettings
{
    public const string SectionName = "Jwt";
    public string Issuer { get; set; } = "Libra-Nextgen";
    public string Audience { get; set; } = "Libra-Console";
    public int TokenExpirationMinutes { get; set; } = 120;
    public int RefreshTokenExpirationDays { get; set; } = 7;

    public RSA Rsa { get; }

    public JwtSettings()
    {
        Rsa = RSA.Create(2048);
    }

    public string GetPublicKeyPem() => Rsa.ExportSubjectPublicKeyInfoPem();
    public string GetPrivateKeyPem() => Rsa.ExportPkcs8PrivateKeyPem();
}
