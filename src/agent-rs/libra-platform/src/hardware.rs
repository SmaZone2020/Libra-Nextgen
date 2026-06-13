use libra_common::models::{CpuInfo, DiskInfo, DisplayInfo, GpuInfo, HardwareInfo, RamInfo};
use sha2::{Digest, Sha256};

/// Collect hardware information from the current machine.
/// Uses wmic (primary) and sysinfo (fallback) — no PowerShell dependency.
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
    // Try wmic first
    if let Ok(info) = wmi_cpu() { return info; }
    // sysinfo fallback
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
    // Try wmic first
    if let Ok(gpus) = wmi_gpus() { if !gpus.is_empty() { return gpus; } }
    // sysinfo fallback
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
    // sysinfo provides reliable disk sizes
    let sys_disks = sysinfo_disks();

    // Try wmic for model/serial info
    if let Ok(disks) = wmi_disks() { if !disks.is_empty() { return disks; } }

    sys_disks
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
            let size_bytes: u64 = parts[2].trim().parse().unwrap_or(0);
            disks.push(DiskInfo {
                model,
                size_bytes,
                media_type: opt_str(parts.get(3).map(|s| s.trim())),
                serial_number: opt_str(parts.get(4).map(|s| s.trim())),
            });
        }
    }
    Ok(disks)
}

// ── RAM ──────────────────────────────────────────────────────────────────

fn collect_ram() -> RamInfo {
    // sysinfo is the most reliable for RAM
    let sys = sysinfo::System::new_all();
    let total = sys.total_memory();
    RamInfo { total_bytes: total }
}

// ── Displays ─────────────────────────────────────────────────────────────

fn collect_displays() -> Vec<DisplayInfo> {
    // Try wmic first
    if let Ok(displays) = wmi_displays() { if !disks_is_empty(&displays) { return displays; } }
    // Fallback: empty
    vec![]
}

#[cfg(windows)]
fn wmi_displays() -> Result<Vec<DisplayInfo>, ()> {
    let output = run_hidden("wmic", &["path", "Win32_DesktopMonitor", "get", "Name,ScreenWidth,ScreenHeight", "/format:csv"])?;
    let text = String::from_utf8_lossy(&output);
    let mut displays = Vec::new();
    let mut idx = 0;
    for line in text.lines().skip(2) {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() >= 4 {
            let name = parts[1].trim().to_string();
            let width: u32 = parts[2].trim().parse().unwrap_or(0);
            let height: u32 = parts[3].trim().parse().unwrap_or(0);
            if width > 0 && height > 0 {
                let display_name = if name.is_empty() {
                    format!("Monitor {}", idx + 1)
                } else {
                    name
                };
                displays.push(DisplayInfo { name: display_name, width, height });
                idx += 1;
            }
        }
    }
    Ok(displays)
}

fn disks_is_empty(_displays: &[DisplayInfo]) -> bool {
    _displays.is_empty()
}

// ── Helpers ──────────────────────────────────────────────────────────────

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

fn wmi_single(class: &str, property: &str) -> Option<String> {
    #[cfg(windows)]
    {
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

fn opt_str(s: Option<&str>) -> Option<String> {
    s.filter(|s| !s.is_empty()).map(|s| s.to_string())
}
