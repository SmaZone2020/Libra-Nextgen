//! DLL fetch and decrypt — downloads the encrypted core DLL from the server,
//! decrypts the AES key using RSA, then decrypts the DLL with AES-256-GCM.

use aes_gcm::{Aes256Gcm, Key, KeyInit, Nonce};
use aes_gcm::aead::Aead;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use rsa::{RsaPrivateKey, pkcs8::DecodePrivateKey};
use sha2::Sha256;

const AES_KEY_SIZE: usize = 32;
const AES_NONCE_SIZE: usize = 12;

/// Decrypt the AES-256 key from the RSA-encrypted blob in the config.
pub fn decrypt_aes_key(encrypted_aes_key_b64: &str, rsa_private_key_b64: &str) -> Result<[u8; AES_KEY_SIZE], String> {
    let encrypted = B64.decode(encrypted_aes_key_b64)
        .map_err(|e| format!("Failed to decode encrypted AES key: {}", e))?;

    let priv_der = B64.decode(rsa_private_key_b64)
        .map_err(|e| format!("Failed to decode RSA private key: {}", e))?;

    let private_key = RsaPrivateKey::from_pkcs8_der(&priv_der)
        .map_err(|e| format!("Failed to parse RSA private key: {}", e))?;

    let decrypted = private_key.decrypt(rsa::Oaep::new::<Sha256>(), &encrypted)
        .map_err(|e| format!("RSA decryption failed: {}", e))?;

    if decrypted.len() != AES_KEY_SIZE {
        return Err(format!("Invalid AES key length: {} (expected {})", decrypted.len(), AES_KEY_SIZE));
    }

    let mut key = [0u8; AES_KEY_SIZE];
    key.copy_from_slice(&decrypted);
    Ok(key)
}

/// Download the encrypted core DLL from the server.
pub async fn download_core(download_url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client.get(download_url)
        .send()
        .await
        .map_err(|e| format!("HTTP GET failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned HTTP {}", resp.status()));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read response body: {}", e))
}

/// Decrypt the core DLL using AES-256-GCM.
/// Expects bytes in format: nonce(12) || ciphertext || tag(16)
pub fn decrypt_dll(encrypted_bytes: &[u8], aes_key: &[u8; AES_KEY_SIZE]) -> Result<Vec<u8>, String> {
    if encrypted_bytes.len() < AES_NONCE_SIZE + 16 {
        return Err("Encrypted DLL too short".into());
    }

    let nonce = Nonce::from_slice(&encrypted_bytes[..AES_NONCE_SIZE]);
    let ciphertext_with_tag = &encrypted_bytes[AES_NONCE_SIZE..];

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(aes_key));

    cipher.decrypt(nonce, ciphertext_with_tag)
        .map_err(|_| "AES-GCM decryption failed".into())
}
