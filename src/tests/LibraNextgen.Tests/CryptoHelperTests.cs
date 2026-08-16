using System.Security.Cryptography;
using System.Text;
using LibraNextgen.Common.Protocol;
using Xunit;

namespace LibraNextgen.Tests;

public class CryptoHelperTests
{
    private static readonly byte[] FixedKey =
    {
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
        0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F,
    };

    // Vector produced independently (fixed nonce 0xA0..0xAB) to pin the exact
    // `nonce || tag || ciphertext` layout and match the Rust libra-crypto test.
    private const string InteropVector =
        "oKGio6SlpqeoqaqrILXSPpyl22AxzrtwgykzeI59EEEq627WABfm824UtLsCwykw5tIxGLw/FLVLng==";
    private const string InteropPlaintext = "hello libra interop test 12345";

    [Fact]
    public void EncryptThenDecrypt_RoundTrips()
    {
        var plaintext = "attack at dawn \u4e2d\u6587 \ud83d\ude80";
        var encrypted = CryptoHelper.EncryptPayload(plaintext, FixedKey);
        var decrypted = CryptoHelper.DecryptPayload(encrypted, FixedKey);
        Assert.Equal(plaintext, decrypted);
    }

    [Fact]
    public void Decrypt_InteropVector_MatchesRustLayout()
    {
        var decrypted = CryptoHelper.DecryptPayload(InteropVector, FixedKey);
        Assert.Equal(InteropPlaintext, decrypted);
    }

    [Fact]
    public void Decrypt_TamperedTag_Throws()
    {
        var encrypted = CryptoHelper.EncryptPayload("secret", FixedKey);
        var raw = Convert.FromBase64String(encrypted);

        // Flip a bit inside the tag region (bytes 12..28)
        raw[15] ^= 0x01;
        var tampered = Convert.ToBase64String(raw);

        Assert.ThrowsAny<CryptographicException>(() =>
            CryptoHelper.DecryptPayload(tampered, FixedKey));
    }

    [Fact]
    public void Encrypt_ProducesNonceTagCiphertextLayout()
    {
        var encrypted = CryptoHelper.EncryptPayload("layout", FixedKey);
        var raw = Convert.FromBase64String(encrypted);

        // nonce(12) + tag(16) + ciphertext(len("layout") == 6)
        Assert.Equal(12 + 16 + 6, raw.Length);
    }

    [Fact]
    public void AesGcmDecrypt_WrongKey_Throws()
    {
        var encrypted = CryptoHelper.EncryptPayload("secret", FixedKey);
        var wrongKey = new byte[32];
        Assert.ThrowsAny<CryptographicException>(() =>
            CryptoHelper.DecryptPayload(encrypted, wrongKey));
    }

    [Fact]
    public void RsaEncryptDecrypt_RoundTrips()
    {
        var (pub, priv) = CryptoHelper.GenerateRsaKeyPair();
        var plaintext = Encoding.UTF8.GetBytes("session key material");
        var encrypted = CryptoHelper.RsaEncrypt(plaintext, pub);
        var decrypted = CryptoHelper.RsaDecrypt(encrypted, priv);
        Assert.Equal(plaintext, decrypted);
    }
}
