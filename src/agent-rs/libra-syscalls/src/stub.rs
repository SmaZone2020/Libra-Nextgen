//! 间接 syscall 的汇编桥与 SSN 槽。
//!
//! 设计（与参考实现差异化）：
//! - 每个 `Nt*` 一个专用裸 stub，SSN 从各自的全局槽读取（`dword ptr [rip + 槽]`），
//!   trampoline 从单一全局槽读取；无运行时自修改代码、无跨线程共享可变状态。
//! - stub 只搬运第一参数 `rcx -> r10` 并 `jmp trampoline`；第 2~4 参数保持
//!   rdx/r8/r9 不动，第 5+ 参数仍在栈上 —— 与 Win64/syscall 约定的栈布局一致。
//! - SSN 槽为 `u32`（非 u16），读取 4 字节，初始化时写 `ssn as u32`。

use core::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use crate::table::SyscallTable;

/// 全局 trampoline（`syscall` 指令地址），初始化时填充一次，之后只读。
#[used]
#[no_mangle]
pub static LIBRA_TRAMPOLINE: AtomicU64 = AtomicU64::new(0);

/// 一次声明全部 40 个 syscall 的槽位 + 汇编桥 + 填充逻辑。
///
/// 列表只在此处维护一次；`(stub 符号名, SSN 槽符号名, ntdll 导出名)`。
macro_rules! syscall_table {
    ($(($stub:ident, $slot:ident, $export:literal)),* $(,)?) => {
        $(
            #[used]
            #[no_mangle]
            pub static $slot: AtomicU32 = AtomicU32::new(0);
        )*

        core::arch::global_asm!(
            concat!(
                $(
                    ".p2align 4\n",
                    ".globl ", stringify!($stub), "\n",
                    stringify!($stub), ":\n",
                    "    mov r10, rcx\n",
                    "    mov eax, dword ptr [rip + ", stringify!($slot), "]\n",
                    "    mov r11, qword ptr [rip + LIBRA_TRAMPOLINE]\n",
                    "    jmp r11\n",
                )*
            )
        );

        /// 把解析出的 SSN 写入各槽位。任一解析失败即返回错误。
        pub fn write_ssn(table: &SyscallTable) -> Result<(), &'static str> {
            $(
                let ssn = table.resolve_ssn($export)?;
                $slot.store(ssn as u32, Ordering::Relaxed);
            )*
            Ok(())
        }
    };
}

syscall_table!(
    (libra_nt_close, LIBRA_SSN_NT_CLOSE, "NtClose"),
    (
        libra_nt_open_process,
        LIBRA_SSN_NT_OPEN_PROCESS,
        "NtOpenProcess"
    ),
    (
        libra_nt_open_thread,
        LIBRA_SSN_NT_OPEN_THREAD,
        "NtOpenThread"
    ),
    (
        libra_nt_open_process_token,
        LIBRA_SSN_NT_OPEN_PROCESS_TOKEN,
        "NtOpenProcessToken"
    ),
    (
        libra_nt_open_thread_token,
        LIBRA_SSN_NT_OPEN_THREAD_TOKEN,
        "NtOpenThreadToken"
    ),
    (
        libra_nt_terminate_process,
        LIBRA_SSN_NT_TERMINATE_PROCESS,
        "NtTerminateProcess"
    ),
    (
        libra_nt_terminate_thread,
        LIBRA_SSN_NT_TERMINATE_THREAD,
        "NtTerminateThread"
    ),
    (
        libra_nt_suspend_thread,
        LIBRA_SSN_NT_SUSPEND_THREAD,
        "NtSuspendThread"
    ),
    (
        libra_nt_resume_thread,
        LIBRA_SSN_NT_RESUME_THREAD,
        "NtResumeThread"
    ),
    (
        libra_nt_alert_resume_thread,
        LIBRA_SSN_NT_ALERT_RESUME_THREAD,
        "NtAlertResumeThread"
    ),
    (
        libra_nt_get_context_thread,
        LIBRA_SSN_NT_GET_CONTEXT_THREAD,
        "NtGetContextThread"
    ),
    (
        libra_nt_set_context_thread,
        LIBRA_SSN_NT_SET_CONTEXT_THREAD,
        "NtSetContextThread"
    ),
    (
        libra_nt_query_information_process,
        LIBRA_SSN_NT_QUERY_INFORMATION_PROCESS,
        "NtQueryInformationProcess"
    ),
    (
        libra_nt_query_information_thread,
        LIBRA_SSN_NT_QUERY_INFORMATION_THREAD,
        "NtQueryInformationThread"
    ),
    (
        libra_nt_query_information_token,
        LIBRA_SSN_NT_QUERY_INFORMATION_TOKEN,
        "NtQueryInformationToken"
    ),
    (
        libra_nt_query_system_information,
        LIBRA_SSN_NT_QUERY_SYSTEM_INFORMATION,
        "NtQuerySystemInformation"
    ),
    (
        libra_nt_query_object,
        LIBRA_SSN_NT_QUERY_OBJECT,
        "NtQueryObject"
    ),
    (
        libra_nt_query_virtual_memory,
        LIBRA_SSN_NT_QUERY_VIRTUAL_MEMORY,
        "NtQueryVirtualMemory"
    ),
    (
        libra_nt_allocate_virtual_memory,
        LIBRA_SSN_NT_ALLOCATE_VIRTUAL_MEMORY,
        "NtAllocateVirtualMemory"
    ),
    (
        libra_nt_free_virtual_memory,
        LIBRA_SSN_NT_FREE_VIRTUAL_MEMORY,
        "NtFreeVirtualMemory"
    ),
    (
        libra_nt_protect_virtual_memory,
        LIBRA_SSN_NT_PROTECT_VIRTUAL_MEMORY,
        "NtProtectVirtualMemory"
    ),
    (
        libra_nt_write_virtual_memory,
        LIBRA_SSN_NT_WRITE_VIRTUAL_MEMORY,
        "NtWriteVirtualMemory"
    ),
    (
        libra_nt_read_virtual_memory,
        LIBRA_SSN_NT_READ_VIRTUAL_MEMORY,
        "NtReadVirtualMemory"
    ),
    (
        libra_nt_unmap_view_of_section,
        LIBRA_SSN_NT_UNMAP_VIEW_OF_SECTION,
        "NtUnmapViewOfSection"
    ),
    (
        libra_nt_map_view_of_section,
        LIBRA_SSN_NT_MAP_VIEW_OF_SECTION,
        "NtMapViewOfSection"
    ),
    (
        libra_nt_create_section,
        LIBRA_SSN_NT_CREATE_SECTION,
        "NtCreateSection"
    ),
    (
        libra_nt_open_section,
        LIBRA_SSN_NT_OPEN_SECTION,
        "NtOpenSection"
    ),
    (
        libra_nt_create_event,
        LIBRA_SSN_NT_CREATE_EVENT,
        "NtCreateEvent"
    ),
    (libra_nt_set_event, LIBRA_SSN_NT_SET_EVENT, "NtSetEvent"),
    (
        libra_nt_wait_for_single_object,
        LIBRA_SSN_NT_WAIT_FOR_SINGLE_OBJECT,
        "NtWaitForSingleObject"
    ),
    (
        libra_nt_signal_and_wait_for_single_object,
        LIBRA_SSN_NT_SIGNAL_AND_WAIT_FOR_SINGLE_OBJECT,
        "NtSignalAndWaitForSingleObject"
    ),
    (
        libra_nt_create_thread_ex,
        LIBRA_SSN_NT_CREATE_THREAD_EX,
        "NtCreateThreadEx"
    ),
    (
        libra_nt_queue_apc_thread,
        LIBRA_SSN_NT_QUEUE_APC_THREAD,
        "NtQueueApcThread"
    ),
    (
        libra_nt_duplicate_object,
        LIBRA_SSN_NT_DUPLICATE_OBJECT,
        "NtDuplicateObject"
    ),
    (
        libra_nt_duplicate_token,
        LIBRA_SSN_NT_DUPLICATE_TOKEN,
        "NtDuplicateToken"
    ),
    (
        libra_nt_set_information_thread,
        LIBRA_SSN_NT_SET_INFORMATION_THREAD,
        "NtSetInformationThread"
    ),
    (
        libra_nt_set_information_process,
        LIBRA_SSN_NT_SET_INFORMATION_PROCESS,
        "NtSetInformationProcess"
    ),
    (
        libra_nt_set_information_virtual_memory,
        LIBRA_SSN_NT_SET_INFORMATION_VIRTUAL_MEMORY,
        "NtSetInformationVirtualMemory"
    ),
    (
        libra_nt_get_next_thread,
        LIBRA_SSN_NT_GET_NEXT_THREAD,
        "NtGetNextThread"
    ),
    (
        libra_nt_delay_execution,
        LIBRA_SSN_NT_DELAY_EXECUTION,
        "NtDelayExecution"
    ),
);
