//! 基础类型：NTSTATUS、句柄、布尔、时间间隔。
//!
//! 全部使用可 ABI 直传的原始类型，避免在 syscall 边界引入 repr(Rust) 结构。

#![allow(dead_code)]

/// NT 状态码。`STATUS_SUCCESS == 0`，其余为错误码。
pub type NtStatus = i32;

/// 成功状态码。
pub const STATUS_SUCCESS: NtStatus = 0;

/// 通用句柄。底层是 `*mut c_void`，这里以 `usize` 传递，保持封装简洁。
pub type Handle = usize;

/// 访问权限掩码。
pub type AccessMask = u32;

/// Win32 `BOOLEAN`（1 字节，0 为假，非 0 为真）。
pub type Boolean = u8;

/// `LARGE_INTEGER` 的相对时间表示（负值，单位 100ns）。
/// 用于 `NtDelayExecution` 等需要相对超时的 API。
pub type LargeInteger = i64;

/// 进程/线程 ID 与句柄信息结合体（`CLIENT_ID`）。
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ClientId {
    pub unique_process: Handle,
    pub unique_thread: Handle,
}

impl ClientId {
    pub fn for_process(pid: u32) -> Self {
        Self {
            unique_process: pid as usize,
            unique_thread: 0,
        }
    }
}

/// 对象属性（`OBJECT_ATTRIBUTES`）的极简表示。
/// 大多数初始化场景传空即可（`null`）。
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct ObjectAttributes {
    pub length: u32,
    pub root_directory: Handle,
    pub object_name: usize,
    pub attributes: u32,
    pub security_descriptor: usize,
    pub security_quality_of_service: usize,
}

impl ObjectAttributes {
    pub fn empty() -> Self {
        Self {
            length: core::mem::size_of::<Self>() as u32,
            ..Default::default()
        }
    }
}
