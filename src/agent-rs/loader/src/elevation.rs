#![allow(non_snake_case, non_upper_case_globals)]

use std::ptr;

// ── Public API (Windows implementation) ───────────────────────────────

#[cfg(target_os = "windows")]
/// Attempt to elevate via standard UAC prompt (ShellExecuteW runas).
/// Returns Ok(true) if a new elevated process was spawned (caller should exit).
/// Returns Ok(false) if already admin. Returns Err if user declined UAC.
pub fn try_elevate(exe_path: &str) -> Result<bool, ()> {
    if is_admin() {
        return Ok(false);
    }

    if runas_elevate(exe_path) {
        Ok(true)
    } else {
        Err(())
    }
}

// ── ShellExecuteW runas (UAC prompt) ────────────────────────────────

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
pub fn is_admin() -> bool {
    #[repr(C)]
    struct TokenElevation {
        token_is_elevated: u32,
    }
    const TOKEN_QUERY: u32 = 0x0008;
    const TOKEN_ELEVATION: u32 = 20;
    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(
            process: *mut core::ffi::c_void,
            access: u32,
            token: *mut *mut core::ffi::c_void,
        ) -> i32;
        fn GetTokenInformation(
            token: *mut core::ffi::c_void,
            class: u32,
            info: *mut core::ffi::c_void,
            len: u32,
            ret: *mut u32,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> *mut u8;
        fn CloseHandle(h: *mut u8) -> i32;
    }

    unsafe {
        let mut token: *mut core::ffi::c_void = std::ptr::null_mut();
        if OpenProcessToken(
            GetCurrentProcess() as *mut core::ffi::c_void,
            TOKEN_QUERY,
            &mut token,
        ) == 0
            || token.is_null()
        {
            return false;
        }
        let mut elevation = TokenElevation {
            token_is_elevated: 0,
        };
        let mut ret: u32 = 0;
        let ok = GetTokenInformation(
            token,
            TOKEN_ELEVATION,
            &mut elevation as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<TokenElevation>() as u32,
            &mut ret,
        ) != 0;
        CloseHandle(token as *mut u8);
        ok && elevation.token_is_elevated != 0
    }
}

/// Check if another instance of our exe is running (different PID than us).
#[cfg(target_os = "windows")]
pub fn check_elevated_instance_running(exe_path: &str) -> bool {
    let our_pid = std::process::id();
    let our_name = std::path::Path::new(exe_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    if our_name.is_empty() {
        return false;
    }

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }

        let mut pe: PROCESSENTRY32 = std::mem::zeroed();
        pe.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;

        if Process32First(snapshot, &mut pe) != 0 {
            loop {
                let pid = pe.th32ProcessID;
                if pid != our_pid && pid != 0 {
                    let name_len = pe
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(pe.szExeFile.len());
                    let proc_name =
                        String::from_utf16_lossy(&pe.szExeFile[..name_len]).to_lowercase();
                    if proc_name == our_name {
                        CloseHandle(snapshot as *mut u8);
                        return true;
                    }
                }
                if Process32Next(snapshot, &mut pe) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot as *mut u8);
    }
    false
}

// ── PEB Spoofing ────────────────────────────────────────────────────

/// Spoof the PEB ImagePathName and CommandLine to appear as a legitimate process.
/// x86_64-only: the PEB/parameter-block offsets and the gs:[0x60] TEB access
/// follow the AMD64 ABI. On other architectures (e.g. aarch64 Windows) this
/// degrades to a no-op.
#[cfg(target_os = "windows")]
pub fn spoof_peb(fake_name: &str) {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    unsafe {
        let peb: *mut u8;
        std::arch::asm!("mov {}, gs:[0x60]", out(reg) peb);
        if peb.is_null() {
            return;
        }

        if peb as usize >= 0x0000800000000000 {
            return;
        }

        let params_ptr = peb.add(0x20) as *const *mut u8;
        if is_bad_read_ptr(params_ptr as *const u8, std::mem::size_of::<*mut u8>()) {
            return;
        }
        let process_params = *params_ptr;
        if process_params.is_null() {
            return;
        }
        if process_params as usize >= 0x0000800000000000 {
            return;
        }

        let image_path = process_params.add(0x60) as *mut UnicodeString;
        let command_line = process_params.add(0x70) as *mut UnicodeString;

        let us_size = std::mem::size_of::<UnicodeString>();
        if is_bad_read_ptr(image_path as *const u8, us_size) {
            return;
        }
        if is_bad_read_ptr(command_line as *const u8, us_size) {
            return;
        }

        let fake_wide = to_wide(fake_name);

        if !(*image_path).Buffer.is_null() && (*image_path).MaximumLength > 0 {
            let buf_size = (*image_path).MaximumLength as usize / 2;
            let copy_count = (fake_wide.len()).min(buf_size);
            if !is_bad_write_ptr((*image_path).Buffer as *mut u8, copy_count * 2) {
                ptr::copy_nonoverlapping(fake_wide.as_ptr(), (*image_path).Buffer, copy_count);
                (*image_path).Length = (copy_count * 2) as u16;
            }
        }

        if !(*command_line).Buffer.is_null() && (*command_line).MaximumLength > 0 {
            let buf_size = (*command_line).MaximumLength as usize / 2;
            let copy_count = (fake_wide.len()).min(buf_size);
            if !is_bad_write_ptr((*command_line).Buffer as *mut u8, copy_count * 2) {
                ptr::copy_nonoverlapping(fake_wide.as_ptr(), (*command_line).Buffer, copy_count);
                (*command_line).Length = (copy_count * 2) as u16;
            }
        }
    }
    #[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
    {
        let _ = fake_name;
    }
}

#[cfg(target_os = "windows")]
unsafe fn is_bad_read_ptr(ptr: *const u8, size: usize) -> bool {
    if ptr.is_null() || size == 0 {
        return true;
    }
    if ptr as usize >= 0x0000800000000000 {
        return true;
    }

    extern "system" {
        fn VirtualQuery(
            lpAddress: *const u8,
            lpBuffer: *mut MEMORY_BASIC_INFORMATION,
            dwLength: usize,
        ) -> usize;
    }
    let mut mbi: MEMORY_BASIC_INFORMATION = std::mem::zeroed();
    let ret = VirtualQuery(
        ptr,
        &mut mbi,
        std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
    );
    if ret == 0 {
        return true;
    }
    if mbi.State != 0x1000 {
        return true;
    }
    if mbi.Protect & 0x01 != 0 || mbi.Protect & 0x100 != 0 {
        return true;
    }
    false
}

#[cfg(target_os = "windows")]
unsafe fn is_bad_write_ptr(ptr: *mut u8, size: usize) -> bool {
    if ptr.is_null() || size == 0 {
        return true;
    }
    if ptr as usize >= 0x0000800000000000 {
        return true;
    }

    extern "system" {
        fn VirtualQuery(
            lpAddress: *const u8,
            lpBuffer: *mut MEMORY_BASIC_INFORMATION,
            dwLength: usize,
        ) -> usize;
    }
    let mut mbi: MEMORY_BASIC_INFORMATION = std::mem::zeroed();
    let ret = VirtualQuery(
        ptr as *const u8,
        &mut mbi,
        std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
    );
    if ret == 0 {
        return true;
    }
    if mbi.State != 0x1000 {
        return true;
    }
    if mbi.Protect & 0x01 != 0 || mbi.Protect & 0x100 != 0 {
        return true;
    }
    false
}

// ── Helpers ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

// ── Windows Types & Constants ───────────────────────────────────────

#[cfg(target_os = "windows")]
#[allow(dead_code)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const SW_SHOWNORMAL: i32 = 1;
#[cfg(target_os = "windows")]
const TH32CS_SNAPPROCESS: u32 = 0x00000002;
#[cfg(target_os = "windows")]
const INVALID_HANDLE_VALUE: *mut std::ffi::c_void = -1isize as *mut std::ffi::c_void;

#[cfg(target_os = "windows")]
#[repr(C)]
struct UnicodeString {
    Length: u16,
    MaximumLength: u16,
    Buffer: *mut u16,
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
struct MEMORY_BASIC_INFORMATION {
    BaseAddress: *mut u8,
    AllocationBase: *mut u8,
    AllocationProtect: u32,
    _pad0: u32,
    RegionSize: usize,
    State: u32,
    Protect: u32,
    Type: u32,
    _pad1: u32,
}

#[cfg(target_os = "windows")]
#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        hwnd: *mut std::ffi::c_void,
        lpOperation: *const u16,
        lpFile: *const u16,
        lpParameters: *const u16,
        lpDirectory: *const u16,
        nShowCmd: i32,
    ) -> usize;

    fn CloseHandle(hObject: *mut u8) -> i32;
    fn CreateToolhelp32Snapshot(dwFlags: u32, th32ProcessID: u32) -> *mut std::ffi::c_void;
    fn Process32First(hSnapshot: *mut std::ffi::c_void, lppe: *mut PROCESSENTRY32) -> i32;
    fn Process32Next(hSnapshot: *mut std::ffi::c_void, lppe: *mut PROCESSENTRY32) -> i32;
}

// ── Public API (non-Windows stubs) ──────────────────────────────────

#[cfg(not(target_os = "windows"))]
pub fn try_elevate(_exe_path: &str) -> Result<bool, ()> {
    // No UAC on non-Windows; treat as "already running elevated".
    Ok(false)
}

#[cfg(not(target_os = "windows"))]
pub fn is_admin() -> bool {
    // Unix agents run with whatever privileges the parent shell has.
    unsafe { libc::geteuid() == 0 }
}

#[cfg(not(target_os = "windows"))]
pub fn check_elevated_instance_running(_exe_path: &str) -> bool {
    false
}

#[cfg(not(target_os = "windows"))]
pub fn spoof_peb(_fake_name: &str) {
    // PEB spoofing is Windows-only; no-op elsewhere.
}
