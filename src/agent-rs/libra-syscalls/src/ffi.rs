//! 最小 Win32 FFI：仅初始化阶段需要的 kernel32 入口。
//!
//! 刻意不依赖 `windows` crate —— 这个地基 crate 会被拉进 bootstrapper，
//! 依赖面越窄越好。

#![allow(dead_code)]

use core::ffi::c_void;

#[link(name = "kernel32")]
extern "system" {
    /// 取已加载模块句柄。`null` 返回宿主进程句柄。
    pub fn GetModuleHandleW(lp_module_name: *const u16) -> *mut c_void;

    /// 按名字解析导出地址（名字为 ASCII，NUL 结尾）。
    pub fn GetProcAddress(h_module: *mut c_void, lp_proc_name: *const u8) -> *mut c_void;

    /// 当前线程 ID。
    pub fn GetCurrentThreadId() -> u32;
}

#[link(name = "ntdll")]
extern "system" {
    /// 注册向量化异常处理器（first=1 表示最高优先级）。返回处理器句柄。
    pub fn RtlAddVectoredExceptionHandler(first: u32, handler: usize) -> *mut c_void;
}

/// 把 `&str` 编码为以 NUL 结尾的 UTF-16，用于 Win32 宽字符 API。
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(core::iter::once(0)).collect()
}
