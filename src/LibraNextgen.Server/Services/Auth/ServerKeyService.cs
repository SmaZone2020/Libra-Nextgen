using System.Security.Cryptography;
using System.Text;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Service.Services.Auth;

/// <summary>
/// </summary>
public class ServerKeyService
{
    private readonly RSA _rsa;
    private readonly string _publicKeyDerB64;
    private readonly string _privateKeyPem;

    public ServerKeyService(IWebHostEnvironment env)
    {
        var keyPath = Environment.GetEnvironmentVariable("LIBRA_SERVER_KEY");
        if (string.IsNullOrWhiteSpace(keyPath))
            keyPath = Path.Combine(env.ContentRootPath, "server-rsa.key");

        if (System.IO.File.Exists(keyPath))
        {
            _privateKeyPem = System.IO.File.ReadAllText(keyPath);
            _rsa = RSA.Create();
            _rsa.ImportFromPem(_privateKeyPem);
        }
        else
        {
            _rsa = RSA.Create(2048);
            _privateKeyPem = _rsa.ExportPkcs8PrivateKeyPem();
            try
            {
                System.IO.File.WriteAllText(keyPath, _privateKeyPem);
            }
            catch
            {
            }
        }

        _publicKeyDerB64 = Convert.ToBase64String(_rsa.ExportSubjectPublicKeyInfo());
    }

    public string PublicKeyDerBase64 => _publicKeyDerB64;

    public byte[] Decrypt(byte[] ciphertext)
    {
        return _rsa.Decrypt(ciphertext, RSAEncryptionPadding.OaepSHA256);
    }

    public string OpenEnvelope(string kBase64, string dBase64)
    {
        var aesKey = Decrypt(Convert.FromBase64String(kBase64));
        return CryptoHelper.DecryptPayload(dBase64, aesKey);
    }
}
