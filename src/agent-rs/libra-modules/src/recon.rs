//! Reconnaissance modules — only the kernel-resident pieces remain:
//! system_info (used at registration) and network_info (geo warmup + WAN info).
//! All other recon functionality lives in the cloud `recon` module.

mod network_info;
mod system_info;

pub use network_info::NetworkInfo;
pub use system_info::SystemInfo;
