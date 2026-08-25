using System.Security.Cryptography;
using System.Text;

namespace LibraNextgen.Common.Protocol;

public static class CryptoHelper
{
    private const int AesKeySize = 256;
    private const int AesTagSize = 16;
    private const int AesNonceSize = 12;

    public static (byte[] encrypted, byte[] nonce, byte[] tag) AesGcmEncrypt(byte[] plaintext, byte[] key)
    {
        var nonce = new byte[AesNonceSize];
        RandomNumberGenerator.Fill(nonce);

        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[AesTagSize];

        using var aes = new AesGcm(key, AesTagSize);
        aes.Encrypt(nonce, plaintext, ciphertext, tag);

        return (ciphertext, nonce, tag);
    }

    public static byte[] AesGcmDecrypt(byte[] ciphertext, byte[] key, byte[] nonce, byte[] tag)
    {
        var plaintext = new byte[ciphertext.Length];

        using var aes = new AesGcm(key, AesTagSize);
        aes.Decrypt(nonce, ciphertext, tag, plaintext);

        return plaintext;
    }

    public static string EncryptPayload(string plaintext, byte[] key)
    {
        var plainBytes = Encoding.UTF8.GetBytes(plaintext);
        var (encrypted, nonce, tag) = AesGcmEncrypt(plainBytes, key);

        var combined = new byte[nonce.Length + tag.Length + encrypted.Length];
        Buffer.BlockCopy(nonce, 0, combined, 0, nonce.Length);
        Buffer.BlockCopy(tag, 0, combined, nonce.Length, tag.Length);
        Buffer.BlockCopy(encrypted, 0, combined, nonce.Length + tag.Length, encrypted.Length);

        return Convert.ToBase64String(combined);
    }

    public static string DecryptPayload(string encryptedBase64, byte[] key)
    {
        var combined = Convert.FromBase64String(encryptedBase64);

        var nonce = new byte[AesNonceSize];
        var tag = new byte[AesTagSize];
        var ciphertext = new byte[combined.Length - AesNonceSize - AesTagSize];

        Buffer.BlockCopy(combined, 0, nonce, 0, AesNonceSize);
        Buffer.BlockCopy(combined, AesNonceSize, tag, 0, AesTagSize);
        Buffer.BlockCopy(combined, AesNonceSize + AesTagSize, ciphertext, 0, ciphertext.Length);

        var plaintext = AesGcmDecrypt(ciphertext, key, nonce, tag);
        return Encoding.UTF8.GetString(plaintext);
    }

    public static string EncryptBytes(byte[] plaintext, byte[] key)
    {
        var (encrypted, nonce, tag) = AesGcmEncrypt(plaintext, key);

        var combined = new byte[nonce.Length + tag.Length + encrypted.Length];
        Buffer.BlockCopy(nonce, 0, combined, 0, nonce.Length);
        Buffer.BlockCopy(tag, 0, combined, nonce.Length, tag.Length);
        Buffer.BlockCopy(encrypted, 0, combined, nonce.Length + tag.Length, encrypted.Length);

        return Convert.ToBase64String(combined);
    }

    public static byte[] DecryptBytes(string encryptedBase64, byte[] key)
    {
        var combined = Convert.FromBase64String(encryptedBase64);

        var nonce = new byte[AesNonceSize];
        var tag = new byte[AesTagSize];
        var ciphertext = new byte[combined.Length - AesNonceSize - AesTagSize];

        Buffer.BlockCopy(combined, 0, nonce, 0, AesNonceSize);
        Buffer.BlockCopy(combined, AesNonceSize, tag, 0, AesTagSize);
        Buffer.BlockCopy(combined, AesNonceSize + AesTagSize, ciphertext, 0, ciphertext.Length);

        return AesGcmDecrypt(ciphertext, key, nonce, tag);
    }

    public static byte[] GenerateAesKey()
    {
        var key = new byte[AesKeySize / 8];
        RandomNumberGenerator.Fill(key);
        return key;
    }

    public static (string publicKey, string privateKey) GenerateRsaKeyPair()
    {
        using var rsa = RSA.Create(2048);
        // SPKI (SubjectPublicKeyInfo) + PKCS#8 — matches the Rust agent's
        // `to_public_key_der()` / `to_pkcs8_der()` exports.
        var pub = Convert.ToBase64String(rsa.ExportSubjectPublicKeyInfo());
        var priv = Convert.ToBase64String(rsa.ExportPkcs8PrivateKey());
        return (pub, priv);
    }

    /// <summary>
    /// Derive the pre-session AES-256 key from the shared beacon secret
    /// (SHA-256). Both the server and the agent know the secret, so the
    /// registration handshake can be encrypted without any key exchange.
    /// Must match the Rust agent's `libra_crypto::derive_pre_session_key`.
    /// </summary>
    public static byte[] DerivePreSessionKey(string beaconSecret)
    {
        return SHA256.HashData(Encoding.UTF8.GetBytes(beaconSecret));
    }

    public static byte[] RsaEncrypt(byte[] data, string publicKeyBase64)
    {
        using var rsa = RSA.Create();
        // The Rust agent exports its public key as SPKI DER, not PKCS#1.
        rsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKeyBase64), out _);
        return rsa.Encrypt(data, RSAEncryptionPadding.OaepSHA256);
    }

    public static byte[] RsaDecrypt(byte[] data, string privateKeyBase64)
    {
        using var rsa = RSA.Create();
        rsa.ImportPkcs8PrivateKey(Convert.FromBase64String(privateKeyBase64), out _);
        return rsa.Decrypt(data, RSAEncryptionPadding.OaepSHA256);
    }
}
