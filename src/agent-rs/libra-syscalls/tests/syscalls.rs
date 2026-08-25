//! 集成测试：真实解析本机 ntdll，验证 SSN 提取、表枚举与一次真实间接 syscall。
//!
//! 仅在 Windows host 上运行（依赖 ntdll 导出形态）。

#![cfg(windows)]

use libra_syscalls::{
    SyscallTable, init, nt_delay_execution, probe_stub, spoof_call, types::STATUS_SUCCESS,
};

use std::ffi::c_void;

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(name: *const u16) -> *mut c_void;
    fn GetProcAddress(h: *mut c_void, name: *const u8) -> *mut c_void;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

#[test]
fn table_enumerates_nt_exports() {
    let table = SyscallTable::build().expect("build table");
    assert!(table.entries.len() >= 40, "expected many Nt* exports, got {}", table.entries.len());
    assert!(table.stride > 0, "stride must be positive");
    assert!(table.trampoline != 0, "trampoline must be resolved");

    let names: Vec<&str> = table.entries.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"NtClose"));
    assert!(names.contains(&"NtAllocateVirtualMemory"));
    assert!(names.contains(&"NtCreateThreadEx"));
}

#[test]
fn probe_extracts_ssn_and_trampoline() {
    let table = SyscallTable::build().expect("build table");
    let nt_close = table
        .entries
        .iter()
        .find(|e| e.name == "NtClose")
        .expect("NtClose present");

    let p = unsafe { probe_stub(nt_close.address) }.expect("probe NtClose");
    assert!(p.ssn != 0, "SSN must be non-zero");
    assert!(p.trampoline > nt_close.address, "trampoline lies after the stub head");

    // trampoline 指向的必须是 `syscall` 指令。
    let bytes = unsafe { core::slice::from_raw_parts(p.trampoline as *const u8, 2) };
    assert_eq!(bytes, &[0x0F, 0x05], "trampoline must point at syscall opcode");
}

#[test]
fn resolve_ssn_matches_direct_probe() {
    let table = SyscallTable::build().expect("build table");
    let resolved = table.resolve_ssn("NtClose").expect("resolve NtClose");

    let addr = table
        .entries
        .iter()
        .find(|e| e.name == "NtClose")
        .map(|e| e.address)
        .unwrap();
    let probed = unsafe { probe_stub(addr) }.expect("probe NtClose").ssn;

    assert_eq!(resolved, probed, "direct probe and resolve must agree");
}

#[test]
fn init_then_invoke_real_syscall() {
    init().expect("init libra-syscalls");

    // 10ms 相对延迟（负值，单位 100ns）。
    let mut interval: i64 = -10_000;
    let status = unsafe { nt_delay_execution(0, &mut interval) };
    assert_eq!(status, STATUS_SUCCESS, "NtDelayExecution should succeed, got {status:#x}");
}

#[test]
fn spoof_call_real_api() {
    init().expect("init libra-syscalls");

    unsafe {
        let kernel32 = GetModuleHandleW(wide("kernel32.dll").as_ptr());
        let getpid = GetProcAddress(kernel32, b"GetCurrentProcessId\0".as_ptr()) as usize;
        assert!(getpid != 0, "GetCurrentProcessId must resolve");

        // 经 stack spoof 调用 GetCurrentProcessId（0 参数）。
        let pid = spoof_call(getpid, 0, 0, 0, 0, 0, 0, 0, 0);
        assert_eq!(pid as u32, std::process::id(), "spoofed call must return real pid");
    }
}
