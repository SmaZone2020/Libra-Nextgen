//!

#![allow(dead_code)]

pub type NtStatus = i32;

pub const STATUS_SUCCESS: NtStatus = 0;

pub type Handle = usize;

pub type AccessMask = u32;

pub type Boolean = u8;

pub type LargeInteger = i64;

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
