use libra_common::models::{CpuInfo, DiskInfo, DisplayInfo, GpuInfo, HardwareInfo, RamInfo};
use sha2::{Digest, Sha256};
use sysinfo::System;

/// Collect hardware information from the current machine.
/// Port of HardwareCollector.cs.
pub fn collect() -> HardwareInfo {
    let sys = System::new_all();

    let cpu = collect_cpu(&sys);
    let gpus = collect_gpus();
    let disks = collect_disks(&sys);
    let ram = collect_ram(&sys);
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

/// Compute a unique hardware ID from key hardware components.
pub fn compute_hwid(info: &HardwareInfo) -> String {
    let mut raw = String::new();
    raw.push_str(&info.cpu.as_ref().map(|c| c.name.as_str()).unwrap_or(""));
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

/// Serialize hardware info to JSON string (matches C# Serialize format).
pub fn serialize(info: &HardwareInfo) -> String {
    serde_json::to_string(info).unwrap_or_else(|_| "{}".into())
}

fn collect_cpu(sys: &System) -> CpuInfo {
    let cpus = sys.cpus();
    let name = cpus.first().map(|c| c.brand().to_string()).unwrap_or_default();
    let physical = sys.physical_core_count().unwrap_or(1);
    let logical = cpus.len();
    let max_clock = cpus.first().map(|c| c.frequency()).unwrap_or(0);

    CpuInfo {
        name,
        physical_cores: physical,
        logical_cores: logical,
        max_clock_mhz: max_clock,
    }
}

fn collect_gpus() -> Vec<GpuInfo> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = std::process::Command::new("wmic")
            .args(["path", "Win32_VideoController", "get", "Name,DriverVersion,AdapterRAM", "/format:csv"])
            .creation_flags(0x08000000)
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut gpus = Vec::new();
            for line in text.lines().skip(2) {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 4 {
                    let name = parts.get(1).map(|s| s.trim()).unwrap_or("").to_string();
                    let driver = parts.get(2).map(|s| s.trim()).filter(|s| !s.is_empty()).map(|s| s.to_string());
                    let vram = parts.get(3)
                        .map(|s| s.trim())
                        .and_then(|s| s.parse::<u64>().ok())
                        .filter(|&v| v > 0);

                    if !name.is_empty() {
                        gpus.push(GpuInfo {
                            name,
                            driver_version: driver,
                            vram_bytes: vram,
                        });
                    }
                }
            }
            if !gpus.is_empty() {
                return gpus;
            }
        }
    }

    vec![GpuInfo {
        name: "Unknown GPU".into(),
        driver_version: None,
        vram_bytes: None,
    }]
}

fn collect_disks(_sys: &System) -> Vec<DiskInfo> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = std::process::Command::new("wmic")
            .args(["path", "Win32_DiskDrive", "get", "Model,Size,MediaType,SerialNumber", "/format:csv"])
            .creation_flags(0x08000000)
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut wmi_disks: Vec<DiskInfo> = Vec::new();
            for line in text.lines().skip(2) {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 5 {
                    let model = parts.get(1).map(|s| s.trim()).unwrap_or("").to_string();
                    let size = parts.get(2).and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0);
                    let media = parts.get(3).map(|s| s.trim()).filter(|s| !s.is_empty()).map(|s| s.to_string());
                    let serial = parts.get(4).map(|s| s.trim()).filter(|s| !s.is_empty()).map(|s| s.to_string());

                    if !model.is_empty() {
                        wmi_disks.push(DiskInfo {
                            model,
                            size_bytes: size,
                            media_type: media,
                            serial_number: serial,
                        });
                    }
                }
            }
            if !wmi_disks.is_empty() {
                return wmi_disks;
            }
        }
    }

    // Fallback using sysinfo
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

fn collect_ram(sys: &System) -> RamInfo {
    RamInfo {
        total_bytes: sys.total_memory(),
    }
}

fn collect_displays() -> Vec<DisplayInfo> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut displays = Vec::new();
        if let Ok(output) = std::process::Command::new("wmic")
            .args(["path", "Win32_DesktopMonitor", "get", "Name,ScreenWidth,ScreenHeight", "/format:csv"])
            .creation_flags(0x08000000)
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines().skip(2) {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 4 {
                    let name = parts.get(1).map(|s| s.trim()).unwrap_or("").to_string();
                    let width = parts.get(2).and_then(|s| s.trim().parse().ok()).unwrap_or(0);
                    let height = parts.get(3).and_then(|s| s.trim().parse().ok()).unwrap_or(0);
                    if !name.is_empty() {
                        displays.push(DisplayInfo { name, width, height });
                    }
                }
            }
        }
        if !displays.is_empty() {
            return displays;
        }
    }

    vec![DisplayInfo {
        name: "Primary Display".into(),
        width: 1920,
        height: 1080,
    }]
}

/// Execute a WMI query and return the first property value.
fn wmi_single(class: &str, property: &str) -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("wmic")
            .args(["path", class, "get", property, "/format:csv"])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;

        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines().skip(2) {
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() >= 2 {
                let val = parts[1].trim();
                if !val.is_empty() {
                    return Some(val.to_string());
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
