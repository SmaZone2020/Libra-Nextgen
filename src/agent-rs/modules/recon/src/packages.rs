//! Installed software inventory — Linux package managers / Windows registry.
//!
//! Linux auto-detects the distro package manager (dpkg / rpm / pacman / apk)
//! and lists installed packages. Windows reads the uninstall registry keys.

pub struct Packages;

impl Packages {
    pub fn collect() -> String {
        #[cfg(target_os = "linux")]
        {
            Self::collect_linux()
        }
        #[cfg(target_os = "windows")]
        {
            Self::collect_windows()
        }
        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        {
            r#"{"pm":"","total":0,"packages":[]}"#.to_string()
        }
    }

    #[cfg(target_os = "linux")]
    fn collect_linux() -> String {
        // Order matters: try the most common/cheap probes first.
        for (probe, parser) in [
            ("dpkg", Self::parse_dpkg as fn(&str) -> Vec<String>),
            ("rpm", Self::parse_rpm),
            ("pacman", Self::parse_pacman),
            ("apk", Self::parse_apk),
        ] {
            if let Some(out) = run(probe, &["--version"]) {
                // Present — now dump the list.
                let (list_args, list_parser): (&[&str], fn(&str) -> Vec<String>) = match probe {
                    "dpkg" => (&["-l", "--no-pager"], Self::parse_dpkg),
                    "rpm" => (
                        &["-qa", "--qf", "%{NAME}\\t%{VERSION}\\t%{ARCH}\\n"],
                        Self::parse_rpm,
                    ),
                    "pacman" => (&["-Q"], Self::parse_pacman),
                    "apk" => (&["list", "--installed"], Self::parse_apk),
                    _ => unreachable!(),
                };
                let Some(list_out) = run(probe, list_args) else {
                    return format!(
                        r#"{{"pm":"{}","total":0,"packages":[],"error":"list failed"}}"#,
                        probe
                    );
                };
                let packages = list_parser(&list_out);
                return format!(
                    r#"{{"pm":"{}","total":{},"packages":[{}]}}"#,
                    probe,
                    packages.len(),
                    packages.join(",")
                );
            }
        }

        // No known package manager found — scan /usr/lib for .so hints (rare).
        r#"{"pm":"","total":0,"packages":[],"error":"no supported package manager"}"#.to_string()
    }

    #[cfg(target_os = "linux")]
    fn parse_dpkg(out: &str) -> Vec<String> {
        // dpkg -l columns: Desired/Status, Name, Version, Arch, Description
        out.lines()
            .filter(|l| l.starts_with("ii") || l.starts_with("hi") || l.starts_with("rc"))
            .filter_map(|l| {
                let rest = l.trim_start_matches(['i', 'h', 'r', 'c', 'u', ' ']);
                let parts: Vec<&str> = rest
                    .splitn(5, char::is_whitespace)
                    .filter(|s| !s.is_empty())
                    .collect();
                if parts.len() < 2 {
                    return None;
                }
                let name = parts[0];
                let version = parts.get(1).copied().unwrap_or("");
                Some(format!(
                    r#"{{"name":"{}","version":"{}","manager":"dpkg"}}"#,
                    escape(name),
                    escape(version),
                ))
            })
            .collect()
    }

    #[cfg(target_os = "linux")]
    fn parse_rpm(out: &str) -> Vec<String> {
        out.lines()
            .filter_map(|l| {
                let mut it = l.split('\t');
                let name = it.next()?.trim();
                let version = it.next().unwrap_or("").trim();
                let arch = it.next().unwrap_or("").trim();
                if name.is_empty() {
                    return None;
                }
                Some(format!(
                    r#"{{"name":"{}","version":"{}","arch":"{}","manager":"rpm"}}"#,
                    escape(name),
                    escape(version),
                    escape(arch),
                ))
            })
            .collect()
    }

    #[cfg(target_os = "linux")]
    fn parse_pacman(out: &str) -> Vec<String> {
        // pacman -Q: "name version"
        out.lines()
            .filter_map(|l| {
                let mut it = l.split_whitespace();
                let name = it.next()?;
                let version = it.next().unwrap_or("");
                Some(format!(
                    r#"{{"name":"{}","version":"{}","manager":"pacman"}}"#,
                    escape(name),
                    escape(version),
                ))
            })
            .collect()
    }

    #[cfg(target_os = "linux")]
    fn parse_apk(out: &str) -> Vec<String> {
        // apk list --installed: "name-version arch {description}"
        out.lines()
            .filter_map(|l| {
                let first = l.split_whitespace().next()?;
                let (pkg, rest) = first.split_once('-')?;
                let version = rest.split('-').next().unwrap_or("");
                Some(format!(
                    r#"{{"name":"{}","version":"{}","manager":"apk"}}"#,
                    escape(pkg),
                    escape(version),
                ))
            })
            .collect()
    }

    #[cfg(target_os = "windows")]
    fn collect_windows() -> String {
        use winreg::enums::*;
        use winreg::RegKey;

        let mut packages = Vec::new();
        for hive in [
            (
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            ),
            (
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            ),
        ] {
            if let Ok(key) = RegKey::predef(hive.0).open_subkey(hive.1) {
                for sub in key.enum_keys().flatten() {
                    if let Ok(sk) = key.open_subkey(&sub) {
                        let name: Option<String> = sk.get_value("DisplayName").ok();
                        let version: Option<String> = sk.get_value("DisplayVersion").ok();
                        if let Some(name) = name {
                            packages.push(format!(
                                r#"{{"name":"{}","version":"{}","manager":"registry"}}"#,
                                escape(&name),
                                escape(version.as_deref().unwrap_or("")),
                            ));
                        }
                    }
                }
            }
        }
        format!(
            r#"{{"pm":"registry","total":{},"packages":[{}]}}"#,
            packages.len(),
            packages.join(",")
        )
    }
}

#[cfg(target_os = "linux")]
fn run(cmd: &str, args: &[&str]) -> Option<String> {
    std::process::Command::new(cmd)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
