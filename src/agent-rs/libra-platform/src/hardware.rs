use libra_common::models::{CpuInfo, DiskInfo, DisplayInfo, GpuInfo, HardwareInfo, RamInfo};
use sha2::{Digest, Sha256};

/// Collect hardware information from the current machine.
/// 全部走进程内 API（sysinfo / 注册表 / Win32），无任何子进程调用
/// （进程面收敛二期：wmic/powershell 已全部移除）。
pub fn collect() -> HardwareInfo {
    let cpu = collect_cpu();
    let gpus = collect_gpus();
    let disks = collect_disks();
    let ram = collect_ram();
    let displays = collect_displays();
    let (motherboard_vendor, bios_version) = board_info();

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

    // sysinfo 在部分 Windows 构建上返回空型号/0 核心，用注册表兜底
    // （HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0，Win2000+ 稳定存在）。
    if info.name.is_empty() || info.logical_cores == 0 {
        #[cfg(windows)]
        {
            if let Some(cpu) = registry_cpu() {
                return cpu;
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

/// 注册表读取 CPU 型号与核心数（HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0）。
#[cfg(windows)]
fn registry_cpu() -> Option<CpuInfo> {
    use windows::Win32::System::Registry::*;
    use windows_core::PCWSTR;

    unsafe {
        let mut key = HKEY::default();
        let path = PCWSTR(wide("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0").as_ptr());
        let status = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            path,
            0,
            KEY_QUERY_VALUE,
            &mut key,
        );
        if status.is_err() {
            return None;
        }

        let mut name = String::new();
        // ProcessorNameString (REG_SZ)
        let name_pcw = PCWSTR(wide("ProcessorNameString").as_ptr());
        let mut buf = [0u16; 512];
        let mut size = (buf.len() * 2) as u32;
        let mut kind: REG_VALUE_TYPE = Default::default();
        if RegQueryValueExW(key, name_pcw, None, Some(&mut kind), Some(buf.as_mut_ptr() as *mut u8), Some(&mut size)).is_ok() {
            name = String::from_utf16_lossy(&buf[..size as usize / 2])
                .trim_end_matches('\0')
                .to_string();
        }

        // ~MHz (REG_DWORD)
        let mut clock_mhz: u32 = 0;
        let clock_pcw = PCWSTR(wide("~MHz").as_ptr());
        let mut csize = 4u32;
        let _ = RegQueryValueExW(key, clock_pcw, None, None, Some(&mut clock_mhz as *mut u32 as *mut u8), Some(&mut csize));

        let _ = RegCloseKey(key);

        if name.is_empty() {
            return None;
        }
        // 核心数用 sysinfo/available_parallelism 兜底
        let logical = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
        let physical = sysinfo::System::new_all().physical_core_count().unwrap_or(logical);
        Some(CpuInfo {
            name,
            physical_cores: physical,
            logical_cores: logical,
            max_clock_mhz: clock_mhz as u64,
        })
    }
}

// ── GPU ──────────────────────────────────────────────────────────────────

fn collect_gpus() -> Vec<GpuInfo> {
    #[cfg(windows)]
    {
        if let Ok(gpus) = dxgi_gpus() {
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

        // If DXGI returned GPUs but all VRAM is 0, leave VRAM unknown —
        // 不再用 wmic 补 VRAM（进程面收敛二期，缺失可接受）。

        Ok(gpus)
    }
}

// ── Disks ────────────────────────────────────────────────────────────────

fn collect_disks() -> Vec<DiskInfo> {
    // sysinfo（跨平台；Windows 上无子进程）
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

// ── RAM ──────────────────────────────────────────────────────────────────

fn collect_ram() -> RamInfo {
    #[cfg(windows)]
    {
        if let Some(ram) = native_ram() {
            return ram;
        }
    }

    // sysinfo fallback (also used on Linux)
    let sys = sysinfo::System::new_all();
    RamInfo { total_bytes: sys.total_memory() }
}

/// GlobalMemoryStatusEx（kernel32，Vista+ 通用，无子进程）。
#[cfg(windows)]
fn native_ram() -> Option<RamInfo> {
    use windows::Win32::System::SystemInformation::*;
    unsafe {
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        if GlobalMemoryStatusEx(&mut status).is_ok() && status.ullTotalPhys > 0 {
            return Some(RamInfo { total_bytes: status.ullTotalPhys });
        }
        None
    }
}

// ── Displays ─────────────────────────────────────────────────────────────

fn collect_displays() -> Vec<DisplayInfo> {
    #[cfg(windows)]
    {
        if let Ok(displays) = gdi_displays() {
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

// ── 主板 / BIOS（注册表，Win2000+ 稳定存在）───────────────────────────

/// 读取主板厂商与 BIOS 版本。
/// - Win32_BaseBoard.Manufacturer ≈ HKLM\HARDWARE\DESCRIPTION\System\BIOS 的
///   BaseBoardManufacturer（部分系统缺失），缺失时回退 SystemManufacturer（整机厂商）
/// - Win32_BIOS.SMBIOSBIOSVersion ≈ BIOSVersion
#[cfg(windows)]
fn board_info() -> (Option<String>, Option<String>) {
    use windows::Win32::System::Registry::*;
    use windows_core::PCWSTR;

    unsafe {
        let mut key = HKEY::default();
        let path = PCWSTR(wide("HARDWARE\\DESCRIPTION\\System\\BIOS").as_ptr());
        if RegOpenKeyExW(HKEY_LOCAL_MACHINE, path, 0, KEY_QUERY_VALUE, &mut key).is_err() {
            return (None, None);
        }

        let read_sz = |name: &str| -> Option<String> {
            let mut buf = [0u16; 512];
            let mut size = (buf.len() * 2) as u32;
            let mut kind: REG_VALUE_TYPE = Default::default();
            let name_pcw = PCWSTR(wide(name).as_ptr());
            let status = RegQueryValueExW(
                key,
                name_pcw,
                None,
                Some(&mut kind),
                Some(buf.as_mut_ptr() as *mut u8),
                Some(&mut size),
            );
            if status.is_err() {
                return None;
            }
            let s = String::from_utf16_lossy(&buf[..size as usize / 2])
                .trim_end_matches('\0')
                .trim()
                .to_string();
            if s.is_empty() { None } else { Some(s) }
        };

        let mut motherboard = read_sz("BaseBoardManufacturer");
        if motherboard.is_none() {
            motherboard = read_sz("SystemManufacturer");
        }
        let bios = read_sz("BIOSVersion").or_else(|| read_sz("BIOSVendor"));

        let _ = RegCloseKey(key);
        (motherboard, bios)
    }
}

#[cfg(not(windows))]
fn board_info() -> (Option<String>, Option<String>) {
    (None, None)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn collect_returns_sane_hardware() {
        let info = collect();
        // CPU 名称不应为空（sysinfo 或注册表兜底）
        assert!(
            info.cpu.as_ref().map(|c| !c.name.is_empty()).unwrap_or(false),
            "cpu name empty: {:?}",
            info.cpu
        );
        // 内存必须 > 0（GlobalMemoryStatusEx 或 sysinfo）
        assert!(info.ram.as_ref().map(|r| r.total_bytes > 0).unwrap_or(false));
        // 主板/BIOS 至少一个可读（注册表）
        assert!(
            info.motherboard_vendor.is_some() || info.bios_version.is_some(),
            "board info missing"
        );
        // HWID 可计算
        assert!(info.hwid.as_deref().map(|h| h.len() == 64).unwrap_or(false));
    }

    #[test]
    fn registry_cpu_fallback_works() {
        // 注册表路径（HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0）在
        // 所有 Windows 上应可读；失败时返回 None 但不应 panic。
        let cpu = registry_cpu();
        assert!(cpu.is_some(), "registry CPU read failed");
    }

    #[test]
    fn native_ram_works() {
        let ram = native_ram();
        assert!(ram.map(|r| r.total_bytes > 0).unwrap_or(false));
    }
}
