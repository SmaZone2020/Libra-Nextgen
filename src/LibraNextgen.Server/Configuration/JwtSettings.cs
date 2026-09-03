using System.Security.Cryptography;
using System.Text;

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
    private static readonly string KeyPath = Path.Combine(KeyDir, "jwt-rsa-key.bin");

    public JwtSettings()
    {
        Rsa = RSA.Create(2048);

        try
        {
            if (File.Exists(KeyPath))
            {
                var xml = ReadProtected(File.ReadAllBytes(KeyPath));
                Rsa.FromXmlString(xml);
            }
            else
            {
                Directory.CreateDirectory(KeyDir);
                var xml = Rsa.ToXmlString(true);
                File.WriteAllBytes(KeyPath, Protect(Encoding.UTF8.GetBytes(xml)));
            }
        }
        catch
        {
            // Fallback to in-memory key if persistence fails
            Rsa = RSA.Create(2048);
        }
    }

    // The private key is DPAPI-protected (CurrentUser) on Windows so it is not
    // stored as plaintext. On non-Windows it is written as-is (chmod 600 recommended).
    private static byte[] Protect(byte[] data) =>
        OperatingSystem.IsWindows()
            ? System.Security.Cryptography.ProtectedData.Protect(data, null, System.Security.Cryptography.DataProtectionScope.CurrentUser)
            : data;

    private static string ReadProtected(byte[] data) =>
        Encoding.UTF8.GetString(
            OperatingSystem.IsWindows()
                ? System.Security.Cryptography.ProtectedData.Unprotect(data, null, System.Security.Cryptography.DataProtectionScope.CurrentUser)
                : data);

    public string GetPublicKeyPem() => Rsa.ExportSubjectPublicKeyInfoPem();
    public string GetPrivateKeyPem() => Rsa.ExportPkcs8PrivateKeyPem();
}
