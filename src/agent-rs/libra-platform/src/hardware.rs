use libra_common::models::{CpuInfo, DiskInfo, DisplayInfo, GpuInfo, HardwareInfo, RamInfo};
use sha2::{Digest, Sha256};

/// Collect hardware information from the current machine.
/// Primary: sysinfo (CPU/RAM/disk sizes) + Win32 FFI (GPU/displays).
/// Falls back to wmic when in-process APIs return invalid data.
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
    let info = sysinfo_cpu();

    // If sysinfo returned garbage (can happen on some Windows builds),
    // fall back to wmic which is more reliable on Windows.
    if info.logical_cores == 0 {
        #[cfg(windows)]
        {
            if let Ok(wmi) = wmi_cpu() {
                return wmi;
            }
        }
    }

    // Last resort: at least fix logical core count
    if info.logical_cores == 0 {
        let logical = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1);
        return CpuInfo { logical_cores: logical, ..info };
    }

    info
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
    let output = run_hidden(
        "wmic",
        &["cpu", "get", "Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed", "/format:csv"],
    )?;
    let text = String::from_utf8_lossy(&output);
    for line in text.lines().skip(2) {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() >= 5 {
            let name = parts[1].trim().to_string();
            let cores: usize = parts[2].trim().parse().unwrap_or(0);
            let threads: usize = parts[3].trim().parse().unwrap_or(0);
            let clock: u64 = parts[4].trim().parse().unwrap_or(0);
            if !name.is_empty() {
                return Ok(CpuInfo {
                    name,
                    physical_cores: cores,
                    logical_cores: threads,
                    max_clock_mhz: clock,
                });
            }
        }
    }
    Err(())
}

// ── GPU ──────────────────────────────────────────────────────────────────

fn collect_gpus() -> Vec<GpuInfo> {
    #[cfg(windows)]
    {
        if let Ok(gpus) = dxgi_gpus() {
            if !gpus.is_empty() { return gpus; }
        }
        if let Ok(gpus) = wmi_gpus() {
            if !gpus.is_empty() { return gpus; }
        }
    }
    vec![GpuInfo { name: "Unknown GPU".into(), driver_version: None, vram_bytes: None }]
}

#[cfg(windows)]
fn dxgi_gpus() -> Result<Vec<GpuInfo>, String> {
    use windows::Win32::Graphics::Dxgi::*;

    unsafe {
        let _ = windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_MULTITHREADED,
        );

        let factory: IDXGIFactory1 = CreateDXGIFactory1()
            .map_err(|e| format!("CreateDXGIFactory1: {e}"))?;

        let mut seen = Vec::new();
        let mut gpus = Vec::new();

        for idx in 0u32.. {
            let adapter = match factory.EnumAdapters1(idx) {
                Ok(a) => a,
                Err(e) => {
                    if e.code() != DXGI_ERROR_NOT_FOUND {
                        libra_common::dlog!("[hw] EnumAdapters1({idx}): {e:?}");
                    }
                    break;
                }
            };

            let desc = adapter
                .GetDesc1()
                .map_err(|e| format!("GetDesc1: {e}"))?;

            // Flags == 0 means DXGI_ADAPTER_FLAG_NONE (hardware adapter)
            if desc.Flags != 0 {
                continue;
            }

            let name = String::from_utf16_lossy(&desc.Description)
                .trim_end_matches('\0')
                .to_string();

            if name.is_empty() || name == "Microsoft Basic Render Driver" {
                continue;
            }

            if seen.contains(&name) {
                continue;
            }
            seen.push(name.clone());

            let vram = desc.DedicatedVideoMemory as u64;
            gpus.push(GpuInfo {
                name,
                driver_version: None,
                vram_bytes: if vram > 0 { Some(vram) } else { None },
            });
        }

        // If DXGI returned GPUs but all VRAM is 0, try wmic for VRAM
        if !gpus.is_empty() && gpus.iter().all(|g| g.vram_bytes.is_none()) {
            if let Ok(wmi) = wmi_gpus() {
                for g in &mut gpus {
                    if let Some(wg) = wmi.iter().find(|w| w.name == g.name) {
                        g.vram_bytes = wg.vram_bytes;
                        g.driver_version = wg.driver_version.clone();
                    }
                }
            }
        }

        Ok(gpus)
    }
}

#[cfg(windows)]
fn wmi_gpus() -> Result<Vec<GpuInfo>, ()> {
    let output = run_hidden(
        "wmic",
        &["path", "Win32_VideoController", "get", "Name,DriverVersion,AdapterRAM", "/format:csv"],
    )?;
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
        if let Some(disks) = wmi_disks() {
            if !disks.is_empty() {
                return disks;
            }
        }
    }

    // sysinfo fallback (also used on Linux)
    sysinfo_disks()
}

#[cfg(windows)]
fn wmi_disks() -> Option<Vec<DiskInfo>> {
    let output = run_hidden(
        "wmic",
        &["path", "Win32_DiskDrive", "get", "Model,Size,MediaType,SerialNumber", "/format:csv"],
    ).ok()?;
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
    Some(disks)
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

// ── RAM ──────────────────────────────────────────────────────────────────

fn collect_ram() -> RamInfo {
    #[cfg(windows)]
    {
        if let Some(ram) = wmi_ram() {
            return ram;
        }
    }

    // sysinfo fallback (also used on Linux)
    let sys = sysinfo::System::new_all();
    RamInfo { total_bytes: sys.total_memory() }
}

#[cfg(windows)]
fn wmi_ram() -> Option<RamInfo> {
    let output = run_hidden(
        "wmic",
        &["path", "Win32_ComputerSystem", "get", "TotalPhysicalMemory", "/format:csv"],
    )
    .ok()?;
    let text = String::from_utf8_lossy(&output);
    for line in text.lines().skip(2) {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() >= 2 {
            if let Ok(bytes) = parts[1].trim().parse::<u64>() {
                if bytes > 0 {
                    return Some(RamInfo { total_bytes: bytes });
                }
            }
        }
    }
    None
}

// ── Displays ─────────────────────────────────────────────────────────────

fn collect_displays() -> Vec<DisplayInfo> {
    #[cfg(windows)]
    {
        if let Ok(displays) = gdi_displays() {
            if !displays.is_empty() { return displays; }
        }
        if let Ok(displays) = wmi_displays() {
            if !displays.is_empty() { return displays; }
        }
    }
    vec![]
}

#[cfg(windows)]
fn gdi_displays() -> Result<Vec<DisplayInfo>, ()> {
    use windows::Win32::Graphics::Gdi::*;
    use windows_core::PCWSTR;

    unsafe {
        let mut displays = Vec::new();
        let mut adapter_idx = 0u32;

        loop {
            let mut adapter = DISPLAY_DEVICEW::default();
            adapter.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;

            if !EnumDisplayDevicesW(None, adapter_idx, &mut adapter, 0).as_bool() {
                break;
            }
            adapter_idx += 1;

            if adapter.StateFlags & DISPLAY_DEVICE_MIRRORING_DRIVER != 0 {
                continue;
            }

            // Enumerate monitors attached to this adapter
            let mut monitor_idx = 0u32;
            loop {
                let mut monitor = DISPLAY_DEVICEW::default();
                monitor.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;

                let adapter_pcwstr = PCWSTR(adapter.DeviceName.as_ptr());
                if !EnumDisplayDevicesW(adapter_pcwstr, monitor_idx, &mut monitor, 0).as_bool() {
                    break;
                }
                monitor_idx += 1;

                let name = String::from_utf16_lossy(&monitor.DeviceString)
                    .trim_end_matches('\0')
                    .to_string();

                let mut dm = DEVMODEW::default();
                dm.dmSize = std::mem::size_of::<DEVMODEW>() as u16;

                let mon_pcwstr = PCWSTR(monitor.DeviceName.as_ptr());
                if EnumDisplaySettingsExW(
                    mon_pcwstr,
                    ENUM_DISPLAY_SETTINGS_MODE(u32::MAX),
                    &mut dm,
                    ENUM_DISPLAY_SETTINGS_FLAGS(0),
                )
                .as_bool()
                {
                    let width = dm.dmPelsWidth;
                    let height = dm.dmPelsHeight;
                    if width > 0 && height > 0 {
                        let display_name = if name.is_empty() {
                            format!("Monitor {}", displays.len() + 1)
                        } else {
                            name
                        };
                        displays.push(DisplayInfo { name: display_name, width, height });
                    }
                }
            }
        }

        Ok(displays)
    }
}

#[cfg(windows)]
fn wmi_displays() -> Result<Vec<DisplayInfo>, ()> {
    let output = run_hidden(
        "wmic",
        &["path", "Win32_DesktopMonitor", "get", "Name,ScreenWidth,ScreenHeight", "/format:csv"],
    )?;
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
