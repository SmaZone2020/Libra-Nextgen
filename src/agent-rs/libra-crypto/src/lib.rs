//! Cryptographic module for the Libra agent.
//!
//! Implements RSA-2048 key exchange + AES-256-GCM payload encryption,
//! matching the C# CryptoHelper + AgentCrypto protocol.

use aes_gcm::{Aes256Gcm, Key, KeyInit, Nonce};
use aes_gcm::aead::Aead;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use rand::RngCore;
use rsa::{RsaPrivateKey, RsaPublicKey, pkcs8::DecodePrivateKey};
use rsa::pkcs1v15::SigningKey;
use rsa::signature::{Signer, SignatureEncoding};
use sha2::{Digest, Sha256};

const AES_KEY_SIZE: usize = 32; // 256 bits
const AES_NONCE_SIZE: usize = 12;
const AES_TAG_SIZE: usize = 16;

/// Derive the pre-session AES-256 key from the shared beacon secret.
///
/// The beacon secret is embedded in the agent at build time and configured on
/// the server, so both sides can derive this key without any key exchange.
/// It is used to encrypt the registration handshake (which would otherwise
/// leak the agent's ephemeral RSA public key, host info and the secret's
/// presence in plaintext on the wire). After registration the server issues a
/// fresh random AES session key via RSA-OAEP and the pre-session key is never
/// used again.
pub fn derive_pre_session_key(beacon_secret: &str) -> [u8; AES_KEY_SIZE] {
    let mut key = [0u8; AES_KEY_SIZE];
    let digest = Sha256::digest(beacon_secret.as_bytes());
    key.copy_from_slice(&digest[..AES_KEY_SIZE]);
    key
}

/// RSA + AES-GCM crypto state for one agent session.
pub struct AgentCrypto {
    rsa_public_key: Option<String>,
    rsa_private_key: Option<String>,
    session_key: Option<[u8; AES_KEY_SIZE]>,
}

impl AgentCrypto {
    pub fn new() -> Self {
        Self {
            rsa_public_key: None,
            rsa_private_key: None,
            session_key: None,
        }
    }

    pub fn rsa_public_key(&self) -> Option<&str> {
        self.rsa_public_key.as_deref()
    }

    pub fn session_key(&self) -> Option<[u8; AES_KEY_SIZE]> {
        self.session_key
    }

    /// Generate an RSA-2048 keypair.
    pub fn generate_key_pair(&mut self) {
        let mut rng = rand::thread_rng();
        let private_key = match RsaPrivateKey::new(&mut rng, 2048) {
            Ok(k) => k,
            Err(e) => {
                libra_common::dlog!("[crypto] RSA key generation failed: {}", e);
                return;
            }
        };
        let public_key = RsaPublicKey::from(&private_key);

        // Export as PKCS#8 DER, then base64 (matching C# ExportRSAPublicKey/ExportRSAPrivateKey)
        use rsa::pkcs8::EncodePublicKey;
        let pub_der = public_key.to_public_key_der().unwrap();
        self.rsa_public_key = Some(B64.encode(pub_der.as_bytes()));

        use rsa::pkcs8::EncodePrivateKey;
        let priv_der = private_key.to_pkcs8_der().unwrap();
        self.rsa_private_key = Some(B64.encode(priv_der.as_bytes()));
    }

    /// Set the session key by decrypting an RSA-encrypted AES key from the server.
    pub fn set_session_key(&mut self, encrypted_key: &[u8]) -> Result<(), String> {
        let priv_b64 = self.rsa_private_key.as_ref()
            .ok_or("RSA keypair not generated")?;
        let session_key = rsa_decrypt(encrypted_key, priv_b64)?;
        if session_key.len() != AES_KEY_SIZE {
            return Err(format!("Invalid session key length: {}", session_key.len()));
        }
        let mut key = [0u8; AES_KEY_SIZE];
        key.copy_from_slice(&session_key);
        self.session_key = Some(key);
        Ok(())
    }

    /// AES-256-GCM encrypt a plaintext string. Returns base64 of (nonce || tag || ciphertext).
    pub fn encrypt_payload(&self, plaintext: &str) -> Result<String, String> {
        let key = self.session_key.as_ref()
            .ok_or("Session key not established")?;
        Ok(encrypt_payload(plaintext, key))
    }

    /// AES-256-GCM decrypt a base64-encoded (nonce || tag || ciphertext).
    pub fn decrypt_payload(&self, ciphertext_b64: &str) -> Result<String, String> {
        let key = self.session_key.as_ref()
            .ok_or("Session key not established")?;
        decrypt_payload(ciphertext_b64, key)
    }

    /// Sign data with RSA private key (SHA-256 + PKCS#1 v1.5 with DigestInfo prefix).
    pub fn sign_payload(&self, data: &str) -> Result<String, String> {
        let priv_b64 = match &self.rsa_private_key {
            Some(k) => k,
            None => return Ok(String::new()),
        };
        let priv_der = B64.decode(priv_b64).map_err(|e| e.to_string())?;
        let private_key = RsaPrivateKey::from_pkcs8_der(&priv_der).map_err(|e| e.to_string())?;

        let signing_key = SigningKey::<Sha256>::new(private_key);
        let sig = signing_key.sign(data.as_bytes());
        Ok(B64.encode(sig.to_bytes()))
    }
}

// ── Low-level crypto helpers (matching C# CryptoHelper) ──────────────

/// Generate a random 256-bit AES key.
pub fn generate_aes_key() -> [u8; AES_KEY_SIZE] {
    let mut key = [0u8; AES_KEY_SIZE];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

/// AES-256-GCM encrypt raw bytes. Returns `nonce || tag || ciphertext`.
///
/// This layout MUST match the C# `CryptoHelper` (nonce, then tag, then
/// ciphertext). The Rust `aes-gcm` crate appends the tag to the ciphertext, so
/// we split it and place the tag immediately after the nonce.
pub fn encrypt_bytes(plaintext: &[u8], key: &[u8; AES_KEY_SIZE]) -> Vec<u8> {
    let mut nonce_bytes = [0u8; AES_NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = match cipher.encrypt(nonce, plaintext) {
        Ok(c) => c,
        Err(e) => {
            libra_common::dlog!("[crypto] AES-GCM encryption failed: {}", e);
            return Vec::new();
        }
    };

    if ciphertext.len() < AES_TAG_SIZE {
        return Vec::new();
    }
    let (ct, tag) = ciphertext.split_at(ciphertext.len() - AES_TAG_SIZE);

    let mut combined = Vec::with_capacity(AES_NONCE_SIZE + AES_TAG_SIZE + ct.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(tag);
    combined.extend_from_slice(ct);
    combined
}

/// AES-256-GCM decrypt raw bytes in `nonce || tag || ciphertext` layout.
pub fn decrypt_bytes(combined: &[u8], key: &[u8; AES_KEY_SIZE]) -> Result<Vec<u8>, String> {
    if combined.len() < AES_NONCE_SIZE + AES_TAG_SIZE {
        return Err("Ciphertext too short".into());
    }

    let nonce_bytes = &combined[..AES_NONCE_SIZE];
    let tag_bytes = &combined[AES_NONCE_SIZE..AES_NONCE_SIZE + AES_TAG_SIZE];
    let ciphertext = &combined[AES_NONCE_SIZE + AES_TAG_SIZE..];

    let mut ciphertext_with_tag = Vec::with_capacity(ciphertext.len() + tag_bytes.len());
    ciphertext_with_tag.extend_from_slice(ciphertext);
    ciphertext_with_tag.extend_from_slice(tag_bytes);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher.decrypt(nonce, ciphertext_with_tag.as_slice())
        .map_err(|_| "AES-GCM decryption failed".to_string())
}

/// AES-256-GCM encrypt a UTF-8 string. Returns base64 of `nonce || tag || ciphertext`.
pub fn encrypt_payload(plaintext: &str, key: &[u8; AES_KEY_SIZE]) -> String {
    B64.encode(&encrypt_bytes(plaintext.as_bytes(), key))
}

/// AES-256-GCM decrypt a base64-encoded `nonce || tag || ciphertext` into a UTF-8 string.
pub fn decrypt_payload(encrypted_b64: &str, key: &[u8; AES_KEY_SIZE]) -> Result<String, String> {
    let combined = B64.decode(encrypted_b64).map_err(|e| e.to_string())?;
    let plaintext = decrypt_bytes(&combined, key)?;
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

/// RSA OAEP SHA-256 encrypt.
pub fn rsa_encrypt(data: &[u8], public_key_b64: &str) -> Result<Vec<u8>, String> {
    use rsa::pkcs8::DecodePublicKey;
    let pub_der = B64.decode(public_key_b64).map_err(|e| e.to_string())?;
    let public_key = RsaPublicKey::from_public_key_der(&pub_der).map_err(|e| e.to_string())?;
    let mut rng = rand::thread_rng();
    public_key.encrypt(&mut rng, rsa::Oaep::new::<Sha256>(), data)
        .map_err(|e| e.to_string())
}

/// RSA OAEP SHA-256 decrypt.
pub fn rsa_decrypt(data: &[u8], private_key_b64: &str) -> Result<Vec<u8>, String> {
    let priv_der = B64.decode(private_key_b64).map_err(|e| e.to_string())?;
    let private_key = RsaPrivateKey::from_pkcs8_der(&priv_der).map_err(|e| e.to_string())?;
    private_key.decrypt(rsa::Oaep::new::<Sha256>(), data)
        .map_err(|e| e.to_string())
}

/// 混合加密：随机 AES-256 key → RSA-OAEP 加密；明文 → AES-GCM。
/// 返回 (RSA 加密的 AES key b64, AES 密文 b64)。
/// 服务端用部署 RSA 私钥解出 AES key 再解密（注册/密钥协商 bootstrap 用）。
pub fn hybrid_encrypt(plaintext: &str, public_key_b64: &str) -> Result<(String, String), String> {
    let aes_key = generate_aes_key();
    let enc_key = rsa_encrypt(&aes_key, public_key_b64)?;
    let cipher = encrypt_payload(plaintext, &aes_key);
    Ok((B64.encode(enc_key), cipher))
}

/// Generate RSA keypair, returns (public_key_b64, private_key_b64).
pub fn generate_rsa_keypair() -> Result<(String, String), String> {
    use rsa::pkcs8::{EncodePublicKey, EncodePrivateKey};
    let mut rng = rand::thread_rng();
    let private_key = RsaPrivateKey::new(&mut rng, 2048).map_err(|e| e.to_string())?;
    let public_key = RsaPublicKey::from(&private_key);

    let pub_der = public_key.to_public_key_der().map_err(|e| e.to_string())?;
    let priv_der = private_key.to_pkcs8_der().map_err(|e| e.to_string())?;

    Ok((B64.encode(pub_der.as_bytes()), B64.encode(priv_der.as_bytes())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = generate_aes_key();
        let plaintext = "Hello, World! This is a test.";
        let encrypted = encrypt_payload(plaintext, &key);
        let decrypted = decrypt_payload(&encrypted, &key).unwrap();
        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_encrypt_bytes_roundtrip() {
        let key = generate_aes_key();
        let data: Vec<u8> = (0..1000u32).map(|i| (i % 256) as u8).collect();
        let encrypted = encrypt_bytes(&data, &key);
        assert_eq!(encrypted.len(), AES_NONCE_SIZE + AES_TAG_SIZE + data.len());
        let decrypted = decrypt_bytes(&encrypted, &key).unwrap();
        assert_eq!(data, decrypted);
    }

    #[test]
    fn test_encrypt_layout_is_nonce_tag_ciphertext() {
        let key: [u8; AES_KEY_SIZE] = [0x42; AES_KEY_SIZE];
        let plaintext = "layout check";
        let encrypted = encrypt_payload(plaintext, &key);
        let combined = B64.decode(&encrypted).unwrap();

        // nonce(12) + tag(16) + ciphertext(plaintext.len())
        assert_eq!(combined.len(), AES_NONCE_SIZE + AES_TAG_SIZE + plaintext.len());

        // The bytes at [12..28] must be the GCM tag, not ciphertext.
        // Verify by feeding the crate `nonce || ciphertext || tag` (i.e. moving
        // the [12..28] block to the end) and confirming it decrypts identically.
        let nonce = &combined[..AES_NONCE_SIZE];
        let tag = &combined[AES_NONCE_SIZE..AES_NONCE_SIZE + AES_TAG_SIZE];
        let ct = &combined[AES_NONCE_SIZE + AES_TAG_SIZE..];

        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let mut ct_with_tag = ct.to_vec();
        ct_with_tag.extend_from_slice(tag);
        let decrypted = cipher.decrypt(Nonce::from_slice(nonce), ct_with_tag.as_slice()).unwrap();
        assert_eq!(decrypted, plaintext.as_bytes());
    }

    #[test]
    fn test_decrypt_csharp_interop_vector() {
        // Vector produced by the C# `CryptoHelper` (nonce || tag || ciphertext),
        // key = 0x00..0x1F, nonce = 0xA0..0xAB, plaintext below.
        let key: [u8; AES_KEY_SIZE] = {
            let mut k = [0u8; AES_KEY_SIZE];
            for (i, b) in k.iter_mut().enumerate() {
                *b = i as u8;
            }
            k
        };
        let vector = "oKGio6SlpqeoqaqrILXSPpyl22AxzrtwgykzeI59EEEq627WABfm824UtLsCwykw5tIxGLw/FLVLng==";
        let plaintext = "hello libra interop test 12345";
        let decrypted = decrypt_payload(vector, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_rsa_keypair_and_encrypt() {
        let (pub_key, priv_key) = generate_rsa_keypair().unwrap();
        let session_key = generate_aes_key();
        let encrypted = rsa_encrypt(&session_key, &pub_key).unwrap();
        let decrypted = rsa_decrypt(&encrypted, &priv_key).unwrap();
        assert_eq!(session_key.to_vec(), decrypted);
    }

    #[test]
    fn test_derive_pre_session_key_deterministic() {
        let k1 = derive_pre_session_key("topsecret");
        let k2 = derive_pre_session_key("topsecret");
        assert_eq!(k1, k2);
        assert_eq!(k1.len(), 32);

        let k3 = derive_pre_session_key("other");
        assert_ne!(k1, k3);
    }

    #[test]
    fn test_pre_session_key_roundtrip() {
        // Simulates the registration handshake: both sides derive the same key
        // from the shared beacon secret, encrypt/decrypt with it.
        let secret = "libra-beacon-secret";
        let key = derive_pre_session_key(secret);
        let msg = r#"{"hostname":"host1","beaconSecret":"libra-beacon-secret","publicKey":"..."}"#;
        let enc = encrypt_payload(msg, &key);
        let dec = decrypt_payload(&enc, &key).unwrap();
        assert_eq!(msg, dec);
    }

    #[test]
    fn test_agent_crypto_full_flow() {
        let mut crypto = AgentCrypto::new();
        crypto.generate_key_pair();

        // Server side: encrypt session key with agent's public key
        let session_key = generate_aes_key();
        let encrypted_key = rsa_encrypt(&session_key, crypto.rsa_public_key().unwrap()).unwrap();

        // Agent side: set session key
        crypto.set_session_key(&encrypted_key).unwrap();

        // Roundtrip
        let msg = "secret message from agent";
        let enc = crypto.encrypt_payload(msg).unwrap();
        let dec = crypto.decrypt_payload(&enc).unwrap();
        assert_eq!(msg, dec);
    }
}
