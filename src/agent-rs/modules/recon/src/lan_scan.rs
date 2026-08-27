use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};

const PING_TIMEOUT_MS: u64 = 500;
const MAX_CONCURRENT_PINGS: usize = 60;
const MAX_HOSTS_PER_SUBNET: u32 = 256;

pub struct LanScan;

impl LanScan {
    pub async fn scan() -> String {
        let devices: Arc<Mutex<HashMap<String, LanDeviceEntry>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // 1. Collect local subnets
        let subnets = get_local_subnets();

        // 2. Parse ARP table
        let arp_entries = get_arp_entries();
        {
            let mut devs = devices.lock().await;
            for e in arp_entries {
                devs.entry(e.ip.clone()).or_insert(e);
            }
        }

        // 3. Ping sweep each /24 subnet
        let sem = Arc::new(Semaphore::new(MAX_CONCURRENT_PINGS));
        let mut ping_tasks = Vec::new();

        for (net, mask, local_ip) in &subnets {
            let host_count = count_hosts(mask);
            if host_count > MAX_HOSTS_PER_SUBNET {
                continue;
            }

            let (start, end) = get_ip_range(net, mask);
            for ip_int in start..=end {
                let ip_str = uint_to_ip_str(ip_int);
                if ip_str == *local_ip {
                    continue;
                }
                {
                    let devs = devices.lock().await;
                    if devs.contains_key(&ip_str) {
                        continue;
                    }
                }

                let devs = devices.clone();
                let sem = sem.clone();
                ping_tasks.push(tokio::spawn(async move {
                    let _permit = sem.acquire().await;
                    ping_one(&ip_str, &devs).await;
                }));
            }
        }

        if !ping_tasks.is_empty() {
            futures_util::future::join_all(ping_tasks).await;
        }

        // 4. Build JSON
        let devs = devices.lock().await;
        build_json(&devs, subnets)
    }
}

struct LanDeviceEntry {
    ip: String,
    mac: String,
    hostname: String,
    source: String,
}

fn get_local_subnets() -> Vec<(String, String, String)> {
    let mut result = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Get interface info via ipconfig
        if let Ok(output) = std::process::Command::new("ipconfig")
            .creation_flags(0x08000000)
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut current_ip = String::new();
            let mut current_mask = String::new();

            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.contains("IPv4 Address") || trimmed.contains("IP Address") {
                    if let Some(addr) = extract_after_colon(trimmed) {
                        // Remove "(Preferred)" suffix if present
                        current_ip = addr.split_whitespace().next().unwrap_or("").to_string();
                    }
                }
                if trimmed.contains("Subnet Mask") {
                    if let Some(mask) = extract_after_colon(trimmed) {
                        current_mask = mask.trim().to_string();
                    }
                    if !current_ip.is_empty() && !current_mask.is_empty() {
                        result.push((current_ip.clone(), current_mask.clone(), current_ip.clone()));
                        current_ip.clear();
                        current_mask.clear();
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Parse `ip addr` or `ifconfig`
        if let Ok(output) = std::process::Command::new("ip")
            .args(["-4", "addr", "show"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);

            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("inet ") {
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    if parts.len() >= 2 {
                        let addr = parts[1];
                        if let Some(slash) = addr.find('/') {
                            let ip = addr[..slash].to_string();
                            let prefix: u8 = addr[slash + 1..].parse().unwrap_or(24);
                            let mask = prefix_to_mask(prefix);
                            if !ip.is_empty() {
                                result.push((ip.clone(), mask, ip.clone()));
                            }
                        }
                    }
                }
            }
        }
    }

    // Fallback: add common subnets
    if result.is_empty() {
        result.push((
            "192.168.1.1".into(),
            "255.255.255.0".into(),
            "192.168.1.1".into(),
        ));
    }

    result
}

fn get_arp_entries() -> Vec<LanDeviceEntry> {
    let mut entries = Vec::new();

    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("arp")
            .args(["-a"])
            .creation_flags(0x08000000)
            .output()
    };
    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("arp").args(["-a"]).output();

    if let Ok(output) = output {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            let ip = find_ip(line);
            let mac = find_mac(line);
            if let (Some(ip), Some(mac)) = (ip, mac) {
                if ip == "0.0.0.0"
                    || ip.starts_with("224.")
                    || ip.starts_with("239.")
                    || mac == "00-00-00-00-00-00"
                    || mac == "FF-FF-FF-FF-FF-FF"
                {
                    continue;
                }
                entries.push(LanDeviceEntry {
                    ip,
                    mac: mac.to_uppercase(),
                    hostname: String::new(),
                    source: "arp".into(),
                });
            }
        }
    }

    entries
}

async fn ping_one(ip: &str, devices: &Arc<Mutex<HashMap<String, LanDeviceEntry>>>) {
    #[cfg(target_os = "windows")]
    let result = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("ping")
            .args(["-n", "1", "-w", &PING_TIMEOUT_MS.to_string(), ip])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
    };
    #[cfg(not(target_os = "windows"))]
    let result = std::process::Command::new("ping")
        .args(["-c", "1", "-W", "1", ip])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    if result.map(|s| s.success()).unwrap_or(false) {
        let mut devs = devices.lock().await;
        devs.entry(ip.to_string()).or_insert(LanDeviceEntry {
            ip: ip.to_string(),
            mac: String::new(),
            hostname: String::new(),
            source: "ping".into(),
        });
    }
}

fn find_ip(line: &str) -> Option<String> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    for part in &parts {
        let cleaned = part.trim_matches(|c: char| !c.is_ascii_digit() && c != '.');
        let segs: Vec<&str> = cleaned.split('.').collect();
        if segs.len() == 4 && segs.iter().all(|s| s.parse::<u8>().is_ok()) {
            return Some(cleaned.to_string());
        }
    }
    // Try regex-style matching for IPs in various formats
    let mut i = 0;
    let bytes = line.as_bytes();
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let mut nums = Vec::new();
            let mut j = i;
            let mut current = 0u32;
            let mut has_dot = false;
            while j < bytes.len() {
                if bytes[j].is_ascii_digit() {
                    current = current * 10 + (bytes[j] - b'0') as u32;
                } else if bytes[j] == b'.' {
                    if current > 255 {
                        break;
                    }
                    nums.push(current);
                    current = 0;
                    has_dot = true;
                } else {
                    break;
                }
                j += 1;
            }
            if current <= 255 {
                nums.push(current);
            }
            if nums.len() == 4 && has_dot {
                return Some(format!("{}.{}.{}.{}", nums[0], nums[1], nums[2], nums[3]));
            }
            i = j;
        } else {
            i += 1;
        }
    }
    None
}

fn find_mac(line: &str) -> Option<String> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    for part in parts {
        let cleaned = part.trim_matches(|c: char| !c.is_ascii_hexdigit() && c != '-' && c != ':');
        let segs: Vec<&str> = cleaned.split(|c| c == '-' || c == ':').collect();
        if segs.len() == 6
            && segs
                .iter()
                .all(|s| s.len() == 2 && s.chars().all(|c| c.is_ascii_hexdigit()))
        {
            return Some(cleaned.replace('-', ":"));
        }
    }
    None
}

fn ip_str_to_uint(ip: &str) -> u32 {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return 0;
    }
    let b0: u32 = parts[0].parse().unwrap_or(0);
    let b1: u32 = parts[1].parse().unwrap_or(0);
    let b2: u32 = parts[2].parse().unwrap_or(0);
    let b3: u32 = parts[3].parse().unwrap_or(0);
    (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
}

fn uint_to_ip_str(val: u32) -> String {
    format!(
        "{}.{}.{}.{}",
        (val >> 24) & 0xFF,
        (val >> 16) & 0xFF,
        (val >> 8) & 0xFF,
        val & 0xFF
    )
}

fn count_hosts(mask: &str) -> u32 {
    (!ip_str_to_uint(mask) & 0xFFFFFFFF).saturating_sub(1)
}

fn get_ip_range(network: &str, mask: &str) -> (u32, u32) {
    let net_val = ip_str_to_uint(network);
    let mask_val = ip_str_to_uint(mask);
    let broadcast = net_val | (!mask_val & 0xFFFFFFFF);
    (net_val + 1, broadcast - 1)
}

fn count_bits(mask: &str) -> u32 {
    ip_str_to_uint(mask).count_ones()
}

#[cfg(not(target_os = "windows"))]
fn prefix_to_mask(prefix: u8) -> String {
    let mask: u32 = if prefix == 0 {
        0
    } else {
        !0u32 << (32 - prefix)
    };
    uint_to_ip_str(mask)
}

fn build_json(
    devices: &HashMap<String, LanDeviceEntry>,
    subnets: Vec<(String, String, String)>,
) -> String {
    let mut sorted_devs: Vec<&LanDeviceEntry> = devices.values().collect();
    sorted_devs.sort_by_key(|d| ip_str_to_uint(&d.ip));

    let dev_parts: Vec<String> = sorted_devs
        .iter()
        .map(|d| {
            format!(
                r#"{{"ip":"{}","mac":"{}","hostname":"{}","source":"{}"}}"#,
                escape(&d.ip),
                escape(&d.mac),
                escape(&d.hostname),
                escape(&d.source)
            )
        })
        .collect();

    let subnet_parts: Vec<String> = subnets
        .iter()
        .map(|(net, mask, _)| {
            let prefix = count_bits(mask);
            format!("\"{}/{}\"", escape(net), prefix)
        })
        .collect();

    format!(
        r#"{{"devices":[{}],"subnets":[{}]}}"#,
        dev_parts.join(","),
        subnet_parts.join(",")
    )
}

fn extract_after_colon(s: &str) -> Option<&str> {
    s.find(':').map(|i| s[i + 1..].trim())
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
