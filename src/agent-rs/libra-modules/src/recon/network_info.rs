use std::sync::Mutex;

mod wifi;
mod wlan_ffi;

use wifi::{collect_proxy, collect_wifi, collect_wifi_bssid, get_dns_suffix};

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
        let wifi = collect_wifi();
        let nearby_wifi = collect_wifi_bssid();
        let proxy = collect_proxy();
        let dns_suffix = get_dns_suffix();

        format!(
            r#"{{"interfaces":[],"wan":{},"wifi":{},"nearbyWifi":{},"proxy":{},"dnsSuffix":"{}"}}"#,
            wan, wifi, nearby_wifi, proxy, escape(&dns_suffix)
        )
    }

    pub async fn collect_wan_only() -> String {
        let wan = Self::collect_wan().await;
        format!(r#"{{"wan":{}}}"#, wan)
    }

    pub fn collect_wifi_only() -> String {
        let wifi = collect_wifi();
        format!(r#"{{"wifi":{}}}"#, wifi)
    }

    pub fn collect_nearby_wifi_only() -> String {
        let nearby = collect_wifi_bssid();
        format!(r#"{{"nearbyWifi":{}}}"#, nearby)
    }

    pub fn collect_proxy_only() -> String {
        let proxy = collect_proxy();
        let dns_suffix = get_dns_suffix();
        format!(r#"{{"proxy":{},"dnsSuffix":"{}"}}"#, proxy, escape(&dns_suffix))
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

pub(super) fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}
