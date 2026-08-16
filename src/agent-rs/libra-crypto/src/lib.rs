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
use sha2::Sha256;

const AES_KEY_SIZE: usize = 32; // 256 bits
const AES_NONCE_SIZE: usize = 12;
const AES_TAG_SIZE: usize = 16;

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
                eprintln!("[crypto] RSA key generation failed: {}", e);
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

/// AES-256-GCM encrypt. Returns base64 of `nonce || tag || ciphertext`.
///
/// This layout MUST match the C# `CryptoHelper.EncryptPayload` (nonce, then
/// tag, then ciphertext). The Rust `aes-gcm` crate appends the tag to the
/// ciphertext, so we split it and place the tag immediately after the nonce.
pub fn encrypt_payload(plaintext: &str, key: &[u8; AES_KEY_SIZE]) -> String {
    let mut nonce_bytes = [0u8; AES_NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(&nonce_bytes);

    // `aes-gcm` returns `ciphertext || tag`.
    let ciphertext = match cipher.encrypt(nonce, plaintext.as_bytes()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[crypto] AES-GCM encryption failed: {}", e);
            return String::new();
        }
    };

    if ciphertext.len() < AES_TAG_SIZE {
        return String::new();
    }
    let (ct, tag) = ciphertext.split_at(ciphertext.len() - AES_TAG_SIZE);

    // Canonical layout: nonce || tag || ciphertext
    let mut combined = Vec::with_capacity(AES_NONCE_SIZE + AES_TAG_SIZE + ct.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(tag);
    combined.extend_from_slice(ct);

    B64.encode(&combined)
}

/// AES-256-GCM decrypt from base64 of `nonce || tag || ciphertext`.
///
/// Matches the C# `CryptoHelper.DecryptPayload` layout.
pub fn decrypt_payload(encrypted_b64: &str, key: &[u8; AES_KEY_SIZE]) -> Result<String, String> {
    let combined = B64.decode(encrypted_b64).map_err(|e| e.to_string())?;

    if combined.len() < AES_NONCE_SIZE + AES_TAG_SIZE {
        return Err("Ciphertext too short".into());
    }

    let nonce_bytes = &combined[..AES_NONCE_SIZE];
    let tag_bytes = &combined[AES_NONCE_SIZE..AES_NONCE_SIZE + AES_TAG_SIZE];
    let ciphertext = &combined[AES_NONCE_SIZE + AES_TAG_SIZE..];

    // `aes-gcm` expects `ciphertext || tag`.
    let mut ciphertext_with_tag = Vec::with_capacity(ciphertext.len() + tag_bytes.len());
    ciphertext_with_tag.extend_from_slice(ciphertext);
    ciphertext_with_tag.extend_from_slice(tag_bytes);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext_with_tag.as_slice())
        .map_err(|_| "AES-GCM decryption failed")?;

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
