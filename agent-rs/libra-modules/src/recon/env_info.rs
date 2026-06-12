use std::env;

pub struct EnvInfo;

impl EnvInfo {
    pub fn collect() -> String {
        #[cfg(target_os = "windows")]
        {
            return Self::collect_windows();
        }
        #[cfg(not(target_os = "windows"))]
        {
            return Self::collect_linux();
        }
    }

    pub fn set(name: &str, value: &str, scope: &str) -> bool {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let _target = if scope == "system" { "Machine" } else { "User" };
            let result = std::process::Command::new("setx")
                .args([name, value, "/m"])
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
            if scope != "system" {
                // For user scope, run without /m
                let _ = std::process::Command::new("setx")
                    .args([name, value])
                    .creation_flags(0x08000000)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
            }
            env::set_var(name, value);
            result.is_ok()
        }
        #[cfg(not(target_os = "windows"))]
        {
            env::set_var(name, value);
            true
        }
    }

    pub fn delete(name: &str, _scope: &str) -> bool {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("setx")
                .args([name, ""])
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
            env::remove_var(name);
            true
        }
        #[cfg(not(target_os = "windows"))]
        {
            env::remove_var(name);
            true
        }
    }

    #[cfg(target_os = "windows")]
    fn collect_windows() -> String {
        use std::os::windows::process::CommandExt;

        let mut system_items = Vec::new();
        let mut user_items = Vec::new();

        // System env vars from registry
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"])
            .creation_flags(0x08000000)
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if let Some((name, val)) = parse_reg_line(line) {
                    system_items.push(format!(
                        r#"{{"name":"{}","value":"{}"}}"#,
                        escape(&name), escape(&val)
                    ));
                }
            }
        }

        // User env vars from registry
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", r"HKCU\Environment"])
            .creation_flags(0x08000000)
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if let Some((name, val)) = parse_reg_line(line) {
                    user_items.push(format!(
                        r#"{{"name":"{}","value":"{}"}}"#,
                        escape(&name), escape(&val)
                    ));
                }
            }
        }

        format!(
            r#"{{"system":[{}],"user":[{}]}}"#,
            system_items.join(","),
            user_items.join(",")
        )
    }

    #[cfg(not(target_os = "windows"))]
    fn collect_linux() -> String {
        let items: Vec<String> = env::vars()
            .map(|(name, value)| {
                format!(
                    r#"{{"name":"{}","value":"{}"}}"#,
                    escape(&name), escape(&value)
                )
            })
            .collect();
        format!(r#"{{"system":[{}],"user":[]}}"#, items.join(","))
    }
}

#[cfg(target_os = "windows")]
fn parse_reg_line(line: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = line.splitn(4, "REG_SZ").collect();
    if parts.len() < 2 {
        // Try REG_EXPAND_SZ
        let parts: Vec<&str> = line.splitn(4, "REG_EXPAND_SZ").collect();
        if parts.len() < 2 {
            return None;
        }
        let name = parts[0].trim().trim_end_matches("REG_EXPAND_SZ").trim().to_string();
        let val = parts[1].trim().to_string();
        if name.is_empty() || name.contains('\\') && !name.contains("REG_") {
            // Filter out header/footer lines
            if name.chars().any(|c| c.is_alphabetic()) {
                Some((name, val))
            } else {
                None
            }
        } else {
            Some((name, val))
        }
    } else {
        let name = parts[0].trim().trim_end_matches("REG_SZ").trim().to_string();
        let val = parts[1].trim().to_string();
        if name.is_empty() {
            None
        } else {
            Some((name, val))
        }
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
