#![cfg(target_os = "windows")]
//! Windows kernel32/advapi32 FFI helpers for LSASS dump (SeDebug + snapshot).

// ── 进程/权限 API ─────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[repr(C)]
pub(crate) struct TOKEN_PRIVILEGES {
    pub(crate) PrivilegeCount: u32,
    pub(crate) Luid: i64,
    pub(crate) Attributes: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
pub(crate) struct PROCESSENTRY32W {
    pub(crate) dwSize: u32,
    cntUsage: u32,
    pub(crate) th32ProcessID: u32,
    th32DefaultHeapID: usize,
    th32ModuleID: u32,
    cntThreads: u32,
    th32ParentProcessID: u32,
    pcPriClassBase: i32,
    dwFlags: u32,
    pub(crate) szExeFile: [u16; 260],
}

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
#[link(name = "advapi32")]
extern "system" {
    pub(crate) fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32)
        -> isize;
    pub(crate) fn CloseHandle(hObject: isize) -> i32;
    pub(crate) fn GetCurrentProcess() -> isize;
    pub(crate) fn CreateToolhelp32Snapshot(dwFlags: u32, th32ProcessID: u32) -> isize;
    pub(crate) fn Process32FirstW(hSnapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
    pub(crate) fn Process32NextW(hSnapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
    pub(crate) fn OpenProcessToken(
        ProcessHandle: isize,
        DesiredAccess: u32,
        TokenHandle: *mut isize,
    ) -> i32;
    pub(crate) fn LookupPrivilegeValueW(
        lpSystemName: *const u16,
        lpName: *const u16,
        lpLuid: *mut i64,
    ) -> i32;
    pub(crate) fn AdjustTokenPrivileges(
        TokenHandle: isize,
        DisableAllPrivileges: i32,
        NewState: *const TOKEN_PRIVILEGES,
        BufferLength: u32,
        PreviousState: *mut TOKEN_PRIVILEGES,
        ReturnLength: *mut u32,
    ) -> i32;
}
