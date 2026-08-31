//! PowerShell inline execution entry.
//!
//!

use libra_psinline;

pub struct PowerShellRunner;

impl PowerShellRunner {
    /// Execute PowerShell script in-process via the hosted CLR.
    #[allow(dead_code)]
    pub fn execute(script: &str, timeout_secs: u64) -> String {
        Self::execute_opts(script, timeout_secs, false)
    }

    pub fn execute_opts(script: &str, timeout_secs: u64, suppress_etw: bool) -> String {
        libra_psinline::execute_inline_opts(script, timeout_secs, suppress_etw)
    }
}
