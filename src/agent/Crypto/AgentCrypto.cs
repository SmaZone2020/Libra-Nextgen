using System.Security.Cryptography;
using System.Text;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Agent.Crypto;

public class AgentCrypto
{
    public string? RsaPublicKey { get; private set; }
    private string? _rsaPrivateKey;
    private byte[]? _sessionKey;

    public void GenerateKeyPair()
    {
        using var rsa = RSA.Create(2048);
        RsaPublicKey = Convert.ToBase64String(rsa.ExportRSAPublicKey());
        _rsaPrivateKey = Convert.ToBase64String(rsa.ExportRSAPrivateKey());
    }

    public void SetSessionKey(byte[] encryptedKey)
    {
        if (_rsaPrivateKey == null)
            throw new InvalidOperationException("RSA keypair not generated");

        _sessionKey = CryptoHelper.RsaDecrypt(encryptedKey, _rsaPrivateKey);
    }

    public string EncryptPayload(string plaintext)
    {
        if (_sessionKey == null)
            throw new InvalidOperationException("Session key not established");
        return CryptoHelper.EncryptPayload(plaintext, _sessionKey);
    }

    public string DecryptPayload(string ciphertext)
    {
        if (_sessionKey == null)
            throw new InvalidOperationException("Session key not established");
        return CryptoHelper.DecryptPayload(ciphertext, _sessionKey);
    }

    public string SignPayload(string data)
    {
        if (_rsaPrivateKey == null) return string.Empty;
        using var rsa = RSA.Create();
        rsa.ImportRSAPrivateKey(Convert.FromBase64String(_rsaPrivateKey), out _);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(data));
        return Convert.ToBase64String(rsa.SignHash(hash, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
    }
}
