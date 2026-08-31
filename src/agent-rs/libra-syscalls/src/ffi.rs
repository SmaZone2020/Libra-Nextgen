//!

#![allow(dead_code)]

use core::ffi::c_void;

#[link(name = "kernel32")]
extern "system" {
    pub fn GetModuleHandleW(lp_module_name: *const u16) -> *mut c_void;

    pub fn GetProcAddress(h_module: *mut c_void, lp_proc_name: *const u8) -> *mut c_void;

    pub fn GetCurrentThreadId() -> u32;
}

#[link(name = "ntdll")]
extern "system" {
    pub fn RtlAddVectoredExceptionHandler(first: u32, handler: usize) -> *mut c_void;
}

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(core::iter::once(0)).collect()
}
