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

    private static readonly string KeyDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Libra-Nextgen");
    private static readonly string KeyPath = Path.Combine(KeyDir, "jwt-rsa-key.xml");

    public JwtSettings()
    {
        Rsa = RSA.Create(2048);

        try
        {
            if (File.Exists(KeyPath))
            {
                var xml = File.ReadAllText(KeyPath);
                Rsa.FromXmlString(xml);
            }
            else
            {
                Directory.CreateDirectory(KeyDir);
                var xml = Rsa.ToXmlString(true);
                File.WriteAllText(KeyPath, xml);
            }
        }
        catch
        {
            // Fallback to in-memory key if persistence fails
            Rsa = RSA.Create(2048);
        }
    }

    public string GetPublicKeyPem() => Rsa.ExportSubjectPublicKeyInfoPem();
    public string GetPrivateKeyPem() => Rsa.ExportPkcs8PrivateKeyPem();
}
