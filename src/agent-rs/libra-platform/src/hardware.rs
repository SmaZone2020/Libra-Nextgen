use libra_common::models::{CpuInfo, DiskInfo, DisplayInfo, GpuInfo, HardwareInfo, RamInfo};
use sha2::{Digest, Sha256};

/// Collect hardware information from the current machine.
/// Windows: Uses PowerShell Get-CimInstance (modern WMI) as primary, wmic fallback, sysinfo last resort.
/// Linux: Uses sysinfo + /proc /sys filesystem.
pub fn collect() -> HardwareInfo {
    let cpu = collect_cpu();
    let gpus = collect_gpus();
    let disks = collect_disks();
    let ram = collect_ram();
    let displays = collect_displays();
    let motherboard_vendor = wmi_single("Win32_BaseBoard", "Manufacturer");
    let bios_version = wmi_single("Win32_BIOS", "SMBIOSBIOSVersion");

    let mut info = HardwareInfo {
        hwid: None,
        cpu: Some(cpu),
        gpus,
        disks,
        ram: Some(ram),
        displays,
        motherboard_vendor,
        bios_version,
    };

    info.hwid = Some(compute_hwid(&info));
    info
}

pub fn compute_hwid(info: &HardwareInfo) -> String {
    let mut raw = String::new();
    raw.push_str(info.cpu.as_ref().map(|c| c.name.as_str()).unwrap_or(""));
    raw.push('|');
    if let Some(disk) = info.disks.first() {
        raw.push_str(disk.serial_number.as_deref().unwrap_or(""));
    }
    raw.push('|');
    raw.push_str(info.motherboard_vendor.as_deref().unwrap_or(""));
    raw.push('|');
    raw.push_str(info.bios_version.as_deref().unwrap_or(""));
    raw.push('|');
    if let Some(ram) = &info.ram {
        raw.push_str(&ram.total_bytes.to_string());
    }

    let hash = Sha256::digest(raw.as_bytes());
    hex::encode(hash)
}

pub fn serialize(info: &HardwareInfo) -> String {
    serde_json::to_string(info).unwrap_or_else(|_| "{}".into())
}

// ── CPU ──────────────────────────────────────────────────────────────────

fn collect_cpu() -> CpuInfo {
    #[cfg(windows)]
    {
        let props = &["Name", "NumberOfCores", "ThreadCount", "MaxClockSpeed"];
        if let Some(v) = ps_wmi_first("Win32_Processor", props) {
            let name = v["Name"].as_str().unwrap_or("").to_string();
            let cores = v["NumberOfCores"].as_u64().unwrap_or(0) as usize;
            let threads = v["ThreadCount"].as_u64().unwrap_or(0) as usize;
            let clock = v["MaxClockSpeed"].as_u64().unwrap_or(0);
            if !name.is_empty() {
                return CpuInfo { name, physical_cores: cores, logical_cores: threads, max_clock_mhz: clock };
            }
        }
        if let Ok(c) = wmi_cpu() { return c; }
    }
    sysinfo_cpu()
}

fn sysinfo_cpu() -> CpuInfo {
    let sys = sysinfo::System::new_all();
    let cpus = sys.cpus();
    let name = cpus.first().map(|c| c.brand().to_string()).unwrap_or_default();
    let physical = sys.physical_core_count().unwrap_or(1);
    let logical = cpus.len();
    let max_clock = cpus.first().map(|c| c.frequency()).unwrap_or(0);
    CpuInfo { name, physical_cores: physical, logical_cores: logical, max_clock_mhz: max_clock }
}

#[cfg(windows)]
fn wmi_cpu() -> Result<CpuInfo, ()> {
    let output = run_hidden("wmic", &["cpu", "get", "Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed", "/format:csv"])?;
    let text = String::from_utf8_lossy(&output);
    for line in text.lines().skip(2) {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() >= 5 {
            let name = parts[1].trim().to_string();
            let cores: usize = parts[2].trim().parse().unwrap_or(0);
            let threads: usize = parts[3].trim().parse().unwrap_or(0);
            let clock: u64 = parts[4].trim().parse().unwrap_or(0);
            if !name.is_empty() {
                return Ok(CpuInfo { name, physical_cores: cores, logical_cores: threads, max_clock_mhz: clock });
            }
        }
    }
    Err(())
}

// ── GPU ──────────────────────────────────────────────────────────────────

fn collect_gpus() -> Vec<GpuInfo> {
    #[cfg(windows)]
    {
        let props = &["Name", "DriverVersion", "AdapterRAM"];
        if let Some(arr) = ps_wmi_all("Win32_VideoController", props) {
            let gpus: Vec<_> = arr.iter().filter_map(|g| {
                let name = g["Name"].as_str().unwrap_or("").to_string();
                if name.is_empty() { return None; }
                Some(GpuInfo {
                    name,
                    driver_version: g["DriverVersion"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    vram_bytes: g["AdapterRAM"].as_u64().filter(|&v| v > 0),
                })
            }).collect();
            if !gpus.is_empty() { return gpus; }
        }
        if let Ok(gpus) = wmi_gpus() { if !gpus.is_empty() { return gpus; } }
    }
    vec![GpuInfo { name: "Unknown GPU".into(), driver_version: None, vram_bytes: None }]
}

#[cfg(windows)]
fn wmi_gpus() -> Result<Vec<GpuInfo>, ()> {
    let output = run_hidden("wmic", &["path", "Win32_VideoController", "get", "Name,DriverVersion,AdapterRAM", "/format:csv"])?;
    let text = String::from_utf8_lossy(&output);
    let mut gpus = Vec::new();
    for line in text.lines().skip(2) {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() >= 4 {
            let name = parts[1].trim().to_string();
            if name.is_empty() { continue; }
            gpus.push(GpuInfo {
                name,
                driver_version: opt_str(parts.get(2).map(|s| s.trim())),
                vram_bytes: parts.get(3).and_then(|s| s.trim().parse().ok()).filter(|&v| v > 0),
            });
        }
    }
    Ok(gpus)
}

// ── Disks ────────────────────────────────────────────────────────────────

fn collect_disks() -> Vec<DiskInfo> {
    #[cfg(windows)]
    {
        let props = &["Model", "Size", "MediaType", "SerialNumber"];
        if let Some(arr) = ps_wmi_all("Win32_DiskDrive", props) {
            let disks: Vec<_> = arr.iter().filter_map(|d| {
                let model = d["Model"].as_str().unwrap_or("").trim().to_string();
                if model.is_empty() { return None; }
                Some(DiskInfo {
                    model,
                    size_bytes: d["Size"].as_u64().unwrap_or(0),
                    media_type: d["MediaType"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    serial_number: d["SerialNumber"].as_str().filter(|s| !s.is_empty()).map(|s| s.trim().to_string()),
                })
            }).collect();
            if !disks.is_empty() { return disks; }
        }
        if let Ok(disks) = wmi_disks() { if !disks.is_empty() { return disks; } }
    }
    sysinfo_disks()
}

fn sysinfo_disks() -> Vec<DiskInfo> {
    sysinfo::Disks::new_with_refreshed_list()
        .iter()
        .map(|d| DiskInfo {
            model: d.name().to_string_lossy().to_string(),
            size_bytes: d.total_space(),
            media_type: Some(if d.is_removable() { "removable" } else { "fixed" }.into()),
            serial_number: None,
        })
        .collect()
}

#[cfg(windows)]
fn wmi_disks() -> Result<Vec<DiskInfo>, ()> {
    let output = run_hidden("wmic", &["path", "Win32_DiskDrive", "get", "Model,Size,MediaType,SerialNumber", "/format:csv"])?;
    let text = String::from_utf8_lossy(&output);
    let mut disks = Vec::new();
    for line in text.lines().skip(2) {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() >= 5 {
            let model = parts[1].trim().to_string();
            if model.is_empty() { continue; }
            disks.push(DiskInfo {
                model,
                size_bytes: parts[2].trim().parse().unwrap_or(0),
                media_type: opt_str(Some(parts[3].trim())),
                serial_number: opt_str(Some(parts[4].trim())),
            });
        }
    }
    Ok(disks)
}

// ── RAM ──────────────────────────────────────────────────────────────────

fn collect_ram() -> RamInfo {
    #[cfg(windows)]
    {
        let props = &["TotalPhysicalMemory"];
        if let Some(v) = ps_wmi_first("Win32_ComputerSystem", props) {
            if let Some(total) = v["TotalPhysicalMemory"].as_u64() {
                if total > 0 { return RamInfo { total_bytes: total }; }
            }
        }
        if let Some(s) = wmi_single("Win32_ComputerSystem", "TotalPhysicalMemory") {
            if let Ok(b) = s.parse::<u64>() { if b > 0 { return RamInfo { total_bytes: b }; } }
        }
    }
    let sys = sysinfo::System::new_all();
    RamInfo { total_bytes: sys.total_memory() }
}

// ── Displays ─────────────────────────────────────────────────────────────

fn collect_displays() -> Vec<DisplayInfo> {
    #[cfg(windows)]
    {
        let props = &["Name", "ScreenWidth", "ScreenHeight"];
        if let Some(arr) = ps_wmi_all("Win32_DesktopMonitor", props) {
            let displays: Vec<_> = arr.iter().filter_map(|d| {
                let name = d["Name"].as_str().unwrap_or("").to_string();
                if name.is_empty() { return None; }
                Some(DisplayInfo {
                    name,
                    width: d["ScreenWidth"].as_u64().unwrap_or(0) as u32,
                    height: d["ScreenHeight"].as_u64().unwrap_or(0) as u32,
                })
            }).collect();
            if !displays.is_empty() { return displays; }
        }
        if let Ok(displays) = wmi_displays() { if !displays.is_empty() { return displays; } }
    }
    vec![DisplayInfo { name: "Primary Display".into(), width: 1920, height: 1080 }]
}

#[cfg(windows)]
fn wmi_displays() -> Result<Vec<DisplayInfo>, ()> {
    let output = run_hidden("wmic", &["path", "Win32_DesktopMonitor", "get", "Name,ScreenWidth,ScreenHeight", "/format:csv"])?;
    let text = String::from_utf8_lossy(&output);
    let mut displays = Vec::new();
    for line in text.lines().skip(2) {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() >= 4 {
            let name = parts[1].trim().to_string();
            if name.is_empty() { continue; }
            displays.push(DisplayInfo {
                name,
                width: parts[2].trim().parse().unwrap_or(0),
                height: parts[3].trim().parse().unwrap_or(0),
            });
        }
    }
    Ok(displays)
}

// ── WMI helpers ──────────────────────────────────────────────────────────

/// Run a PowerShell Get-CimInstance query and return the first result as a Value object.
#[cfg(windows)]
fn ps_wmi_first(class: &str, props: &[&str]) -> Option<serde_json::Value> {
    use std::os::windows::process::CommandExt;
    let prop_list = props.join(",");
    let cmd = format!(
        "Get-CimInstance -Class {} -ErrorAction SilentlyContinue | Select -First 1 -Property {} | ConvertTo-Json -Compress",
        class, prop_list
    );
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &cmd])
        .creation_flags(0x08000000)
        .output().ok()?;
    if !output.status.success() { return None; }
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim()).ok()
}

/// Run a PowerShell Get-CimInstance query and return all results as a Vec of Value objects.
#[cfg(windows)]
fn ps_wmi_all(class: &str, props: &[&str]) -> Option<Vec<serde_json::Value>> {
    use std::os::windows::process::CommandExt;
    let prop_list = props.join(",");
    let cmd = format!(
        "Get-CimInstance -Class {} -ErrorAction SilentlyContinue | Select -Property {} | ConvertTo-Json -Compress",
        class, prop_list
    );
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &cmd])
        .creation_flags(0x08000000)
        .output().ok()?;
    if !output.status.success() { return None; }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let val: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    // If it's a single object, wrap in vec; if array, return as-is
    if val.is_object() {
        Some(vec![val])
    } else if val.is_array() {
        let arr: Vec<serde_json::Value> = serde_json::from_value(val).unwrap_or_default();
        Some(arr)
    } else {
        None
    }
}

/// Get a single string value from WMI. Tries PowerShell first, then wmic.
fn wmi_single(class: &str, property: &str) -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // PowerShell first
        let cmd = format!(
            "(Get-CimInstance -Class {} -ErrorAction SilentlyContinue | Select -First 1).{}",
            class, property
        );
        if let Ok(output) = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &cmd])
            .creation_flags(0x08000000)
            .output()
        {
            if output.status.success() {
                let val = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !val.is_empty() { return Some(val); }
            }
        }
        // Fallback to wmic
        if let Ok(output) = run_hidden("wmic", &["path", class, "get", property, "/format:csv"]) {
            let text = String::from_utf8_lossy(&output);
            for line in text.lines().skip(2) {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 2 {
                    let val = parts[1].trim();
                    if !val.is_empty() { return Some(val.to_string()); }
                }
            }
        }
        None
    }
    #[cfg(not(windows))]
    {
        let _ = (class, property);
        None
    }
}

#[cfg(windows)]
fn run_hidden(cmd: &str, args: &[&str]) -> Result<Vec<u8>, ()> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new(cmd)
        .args(args)
        .creation_flags(0x08000000)
        .output()
        .map(|o| o.stdout)
        .map_err(|_| ())
}

fn opt_str(s: Option<&str>) -> Option<String> {
    s.filter(|s| !s.is_empty()).map(|s| s.to_string())
}
