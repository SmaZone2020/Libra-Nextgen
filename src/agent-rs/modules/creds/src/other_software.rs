pub struct OtherSoftware;

impl OtherSoftware {
    pub fn collect_wechat() -> String {
        let docs = get_documents_dir();
        let xwechat_dir = format!("{}\\Tencent Files\\xwechat_files", docs);

        let dir = match std::fs::read_dir(&xwechat_dir) {
            Ok(d) => d,
            Err(_) => return r#"{"accounts":[]}"#.to_string(),
        };

        let mut accounts = Vec::new();
        for entry in dir.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("wxid_") {
                continue;
            }

            let file_dir = format!("{}\\msg\\file", entry.path().display());
            let mut month_dirs = Vec::new();
            if let Ok(sub_entries) = std::fs::read_dir(&file_dir) {
                for sub in sub_entries.filter_map(|e| e.ok()) {
                    let sub_name = sub.file_name().to_string_lossy().to_string();
                    if is_year_month(&sub_name) {
                        month_dirs.push(sub_name);
                    }
                }
                month_dirs.sort_by(|a, b| b.cmp(a)); // newest first
            }

            accounts.push(format!(
                r#"{{"wxid":"{}","path":"{}","fileDirs":[{}]}}"#,
                escape(&name),
                escape(&entry.path().to_string_lossy()),
                month_dirs.iter().map(|d| format!("\"{}\"", escape(d))).collect::<Vec<_>>().join(",")
            ));
        }

        format!(r#"{{"accounts":[{}]}}"#, accounts.join(","))
    }
}

fn get_documents_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .map(|p| format!("{}\\Documents", p))
            .unwrap_or_else(|_| "C:\\Users\\Default\\Documents".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").unwrap_or_else(|_| "/home".to_string())
    }
}

fn is_year_month(s: &str) -> bool {
    if s.len() != 7 {
        return false;
    }
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 2 {
        return false;
    }
    parts[0].len() == 4
        && parts[0].chars().all(|c| c.is_ascii_digit())
        && parts[1].len() == 2
        && parts[1].chars().all(|c| c.is_ascii_digit())
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
