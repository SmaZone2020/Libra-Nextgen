using System.Security.Cryptography;
using System.Text;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Service.Services;

/// <summary>
/// 服务端 RSA-2048 密钥对（部署级，不随进程重启丢失）：
/// - 私钥用于解密 agent/loader 的混合加密注册与密钥协商（RSA-OAEP-SHA256）
/// - 公钥在构建时注入 agent/loader（InjectedConfig.server_public_key）
/// 存储：私钥 PEM 文件，路径可用 LIBRA_SERVER_KEY 环境变量覆盖（公网部署用绝对路径），
/// 默认在内容根目录 server-rsa.key。
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
                // 目录不可写时仅内存持有（重启后失效，agent 会重注册自愈）
            }
        }

        _publicKeyDerB64 = Convert.ToBase64String(_rsa.ExportSubjectPublicKeyInfo());
    }

    /// <summary>SPKI DER base64（构建时注入 agent/loader）。</summary>
    public string PublicKeyDerBase64 => _publicKeyDerB64;

    /// <summary>解密 RSA-OAEP-SHA256 密文。</summary>
    public byte[] Decrypt(byte[] ciphertext)
    {
        return _rsa.Decrypt(ciphertext, RSAEncryptionPadding.OaepSHA256);
    }

    /// <summary>混合加密信封解析：k=RSA 加密的临时 AES key，d=AES-GCM 密文 → 明文。</summary>
    public string OpenEnvelope(string kBase64, string dBase64)
    {
        var aesKey = Decrypt(Convert.FromBase64String(kBase64));
        return CryptoHelper.DecryptPayload(dBase64, aesKey);
    }
}
