//! DLL fetch and decrypt — downloads the encrypted core DLL from the server,
//! negotiates the AES key over RSA at runtime, then decrypts the DLL with
//! AES-256-GCM.

use aes_gcm::{Aes256Gcm, Key, KeyInit, Nonce};
use aes_gcm::aead::Aead;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use rsa::{RsaPrivateKey, RsaPublicKey};
use rsa::pkcs8::EncodePublicKey;
use sha2::Sha256;

const AES_KEY_SIZE: usize = 32;
const AES_NONCE_SIZE: usize = 12;

/// Negotiate the core AES key with the server.
///
/// Generates an ephemeral RSA-2048 keypair, sends its public key + BeaconSecret
/// to the server via OAuth 风格的混合加密信封（服务端 RSA 公钥加密临时 AES key），
/// and decrypts the returned AES key with the private key. No private key is
/// ever embedded in the binary.
pub async fn handshake_core_key(
    server_url: &str,
    core_key_path: &str,
    build_id: &str,
    beacon_secret: &str,
    server_public_key: &str,
) -> Result<[u8; AES_KEY_SIZE], String> {
    let mut rng = rand::thread_rng();
    let private_key = RsaPrivateKey::new(&mut rng, 2048).map_err(|e| e.to_string())?;
    let public_key = RsaPublicKey::from(&private_key);
    let pub_der = public_key.to_public_key_der().map_err(|e| e.to_string())?;
    let pub_b64 = B64.encode(pub_der.as_bytes());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let plain = serde_json::json!({
        "buildId": build_id,
        "publicKey": pub_b64,
        "beaconSecret": beacon_secret,
    })
    .to_string();

    let body = if server_public_key.is_empty() {
        // 无公钥（dev 直连/旧构建）：明文兼容
        plain
    } else {
        let (enc_key, cipher_body) =
            libra_crypto::hybrid_encrypt(&plain, server_public_key).map_err(|e| e.to_string())?;
        serde_json::json!({
            "grant_type": "client_credentials",
            "client_id": cipher_body,
            "client_secret": enc_key,
        })
        .to_string()
    };

    let resp = client
        .post(format!("{}{}", server_url, core_key_path))
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("core key handshake failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("core key handshake returned HTTP {}", resp.status()));
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let encrypted_b64 = v
        .get("encryptedKey")
        .and_then(|x| x.as_str())
        .ok_or("encryptedKey missing from response")?;

    let encrypted = B64.decode(encrypted_b64).map_err(|e| e.to_string())?;
    let decrypted = private_key
        .decrypt(rsa::Oaep::new::<Sha256>(), &encrypted)
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
