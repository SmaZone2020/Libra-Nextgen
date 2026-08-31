//!
//!   mscoree!CorBindToRuntimeEx("v4.0.30319", ..., IID_ICLRRuntimeHost)
//!   → ICLRRuntimeHost::Start()
//!   → ExecuteInDefaultAppDomain(psinline_stub.dll, "PsInline.Stub", "Run", args)
//!
//!

#![allow(non_snake_case)]
#![allow(clippy::upper_case_acronyms)]
#![allow(dead_code)]

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

#[cfg(target_os = "windows")]
const STUB_DLL: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/stub/psinline_stub.dll"
));
#[cfg(not(target_os = "windows"))]
const STUB_DLL: &[u8] = &[];

// ── GUID ───────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy, PartialEq)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

impl Guid {
    const fn new(d1: u32, d2: u16, d3: u16, d4: [u8; 8]) -> Self {
        Self {
            data1: d1,
            data2: d2,
            data3: d3,
            data4: d4,
        }
    }
}

const CLSID_CorRuntimeHost: Guid = Guid::new(
    0xCB2F6723,
    0xAB3A,
    0x11D2,
    [0x9C, 0x40, 0x00, 0xC0, 0x4F, 0xA3, 0x0A, 0x3E],
);
const IID_ICorRuntimeHost: Guid = Guid::new(
    0xCB2F6722,
    0xAB3A,
    0x11D2,
    [0x9C, 0x40, 0x00, 0xC0, 0x4F, 0xA3, 0x0A, 0x3E],
);
const IID_ICLRRuntimeHost: Guid = Guid::new(
    0x90F1A06C,
    0x7712,
    0x4762,
    [0x86, 0xB5, 0x7A, 0x5E, 0xBA, 0x6B, 0xDB, 0x02],
);
const IID_IDispatch: Guid = Guid::new(
    0x00000000,
    0x0000,
    0x0000,
    [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46],
);

#[repr(C)]
struct ICorRuntimeHostVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    create_logical_thread_state: unsafe extern "system" fn(*mut c_void) -> i32,
    delete_logical_thread_state: unsafe extern "system" fn(*mut c_void) -> i32,
    switch_in_logical_thread_state: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    switch_out_logical_thread_state: unsafe extern "system" fn(*mut c_void, *mut *mut u32) -> i32,
    locks_held_by_logical_thread: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    map_file: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut c_void) -> i32,
    get_configuration: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    start: unsafe extern "system" fn(*mut c_void) -> i32,
    stop: unsafe extern "system" fn(*mut c_void) -> i32,
    create_domain:
        unsafe extern "system" fn(*mut c_void, *const u16, *mut c_void, *mut *mut c_void) -> i32,
    get_default_domain: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    enum_domains: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    next_domain: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut *mut c_void) -> i32,
    close_enum: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
    create_domain_ex: unsafe extern "system" fn(
        *mut c_void,
        *const u16,
        *mut c_void,
        *mut c_void,
        *mut *mut c_void,
    ) -> i32,
    create_domain_setup: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    create_evidence: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    unload_domain: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
    current_domain: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
}

#[repr(C)]
struct ICLRRuntimeHostVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    start: unsafe extern "system" fn(*mut c_void) -> i32,
    stop: unsafe extern "system" fn(*mut c_void) -> i32,
    execute_in_default_app_domain: unsafe extern "system" fn(
        *mut c_void,
        *const u16,
        *const u16,
        *const u16,
        *const u16,
        *mut u32,
    ) -> i32,
    get_default_app_domain: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    execute_assembly: unsafe extern "system" fn(
        *mut c_void,
        *const u16,
        *const u16,
        u32,
        *mut *const u16,
        *mut u32,
    ) -> i32,
    execute_assembly_in_app_domain: unsafe extern "system" fn(
        *mut c_void,
        *mut c_void,
        *const u16,
        u32,
        *mut *const u16,
        *mut u32,
    ) -> i32,
    create_domain:
        unsafe extern "system" fn(*mut c_void, *const u16, *mut c_void, *mut *mut c_void) -> i32,
    create_domain_ex: unsafe extern "system" fn(
        *mut c_void,
        *const u16,
        *mut c_void,
        *mut c_void,
        *mut *mut c_void,
    ) -> i32,
    create_domain_setup: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    create_evidence: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    unload_domain: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
    set_host_control: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
    set_clr_manager: unsafe extern "system" fn(*mut c_void, *mut c_void, *const Guid) -> i32,
    get_clr_manager: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
}

#[repr(C)]
struct IDispatchVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    get_type_info_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    get_type_info: unsafe extern "system" fn(*mut c_void, u32, u32, *mut *mut c_void) -> i32,
    get_ids_of_names: unsafe extern "system" fn(
        *mut c_void,
        *const Guid,
        *mut *mut u16,
        u32,
        u32,
        *mut i32,
    ) -> i32,
    invoke: unsafe extern "system" fn(
        *mut c_void,
        i32,
        *const Guid,
        u32,
        u16,
        *const c_void,
        *mut c_void,
        *mut c_void,
        *mut u32,
    ) -> i32,
}

const IID_NULL: Guid = Guid::new(0, 0, 0, [0; 8]);

#[cfg(target_os = "windows")]
unsafe fn get_dispid(obj: *mut c_void, name: &str) -> Option<i32> {
    let vtbl = &*(*(obj as *const *const IDispatchVtbl));
    let mut name_wide = wide(name);
    let mut dispid: i32 = 0;
    let hr = (vtbl.get_ids_of_names)(
        obj,
        &IID_NULL,
        &mut name_wide.as_mut_ptr(),
        1,
        0,
        &mut dispid,
    );
    if hr == 0 {
        Some(dispid)
    } else {
        None
    }
}

// ── kernel32 FFI ───────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryW(name: *const u16) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const u8) -> *const c_void;
    fn CreateNamedPipeW(
        name: *const u16,
        open_mode: u32,
        pipe_mode: u32,
        max_instances: u32,
        out_buf: u32,
        in_buf: u32,
        default_timeout: u32,
        security: *const c_void,
    ) -> *mut c_void;
    fn ConnectNamedPipe(pipe: *mut c_void, overlapped: *mut c_void) -> i32;
    fn DisconnectNamedPipe(pipe: *mut c_void) -> i32;
    fn PeekNamedPipe(
        pipe: *mut c_void,
        buffer: *mut u8,
        buf_size: u32,
        bytes_read: *mut u32,
        total_avail: *mut u32,
        bytes_left: *mut u32,
    ) -> i32;
    fn ReadFile(
        file: *mut c_void,
        buf: *mut u8,
        n: u32,
        read: *mut u32,
        overlapped: *mut c_void,
    ) -> i32;
    fn CloseHandle(handle: *mut c_void) -> i32;
    fn GetTempPathW(len: u32, buf: *mut u16) -> u32;
    fn GetLastError() -> u32;
}

const PIPE_ACCESS_INBOUND: u32 = 0x1;
const PIPE_TYPE_BYTE: u32 = 0x0;
const PIPE_READMODE_BYTE: u32 = 0x0;
const PIPE_WAIT: u32 = 0x0;
const ERROR_PIPE_CONNECTED: u32 = 535;
const ERROR_BROKEN_PIPE: u32 = 109;
const ERROR_NO_DATA: u32 = 232;
const ERROR_OPERATION_ABORTED: u32 = 995;

#[cfg(target_os = "windows")]
struct ClrHost {
    host: *mut c_void,
    use_new: bool,
    domain: *mut c_void,
    gate: Mutex<()>,
}

#[cfg(target_os = "windows")]
unsafe impl Send for ClrHost {}
#[cfg(target_os = "windows")]
unsafe impl Sync for ClrHost {}

#[cfg(target_os = "windows")]
static CLR: OnceLock<Result<ClrHost, String>> = OnceLock::new();

#[cfg(target_os = "windows")]
fn get_clr_host() -> Result<&'static ClrHost, String> {
    CLR.get_or_init(|| unsafe { init_clr_host() })
        .as_ref()
        .map_err(|e| e.clone())
}

#[cfg(target_os = "windows")]
unsafe fn init_clr_host() -> Result<ClrHost, String> {
    let mscoree = LoadLibraryW(wide("mscoree.dll").as_ptr());
    if mscoree.is_null() {
        return Err("mscoree.dll load failed".into());
    }
    let bind_ptr = GetProcAddress(mscoree, b"CorBindToRuntimeEx\0".as_ptr());
    if bind_ptr.is_null() {
        return Err("CorBindToRuntimeEx export not found".into());
    }
    type CorBindFn = unsafe extern "system" fn(
        *const u16,
        *const u16,
        u32,
        *const Guid,
        *const Guid,
        *mut *mut c_void,
    ) -> i32;
    let bind: CorBindFn = std::mem::transmute(bind_ptr);

    let mut host: *mut c_void = ptr::null_mut();
    let hr = bind(
        wide("v4.0.30319").as_ptr(),
        wide("wks").as_ptr(),
        0,
        &CLSID_CorRuntimeHost,
        &IID_ICorRuntimeHost,
        &mut host,
    );
    if (hr != 0 && hr != 1) || host.is_null() {
        return Err(format!("CorBindToRuntimeEx failed: 0x{:08X}", hr as u32));
    }

    let legacy_vtbl = &*(*(host as *const *const ICorRuntimeHostVtbl));
    let mut new_host: *mut c_void = ptr::null_mut();
    let qhr = (legacy_vtbl.query_interface)(host, &IID_ICLRRuntimeHost, &mut new_host);
    let (runtime_host, use_new) = if qhr == 0 && !new_host.is_null() {
        (new_host, true)
    } else {
        (host, false)
    };

    let mut domain: *mut c_void = ptr::null_mut();
    if use_new {
        let vtbl = &*(*(runtime_host as *const *const ICLRRuntimeHostVtbl));
        let hr = (vtbl.start)(runtime_host);
        if hr != 0 && hr != 1 {
            return Err(format!(
                "ICLRRuntimeHost::Start failed: 0x{:08X}",
                hr as u32
            ));
        }
        let _ = (vtbl.get_default_app_domain)(runtime_host, &mut domain);
    } else {
        let vtbl = &*(*(runtime_host as *const *const ICorRuntimeHostVtbl));
        let hr = (vtbl.start)(runtime_host);
        if hr != 0 && hr != 1 {
            return Err(format!(
                "ICorRuntimeHost::Start failed: 0x{:08X}",
                hr as u32
            ));
        }
        let cdr = (vtbl.create_domain)(
            runtime_host,
            wide("LibraPs").as_ptr(),
            ptr::null_mut(),
            &mut domain,
        );
        if cdr != 0 || domain.is_null() {
            let _ = (vtbl.get_default_domain)(runtime_host, &mut domain);
        }
    }

    let mut dispatch: *mut c_void = ptr::null_mut();
    if !domain.is_null() {
        let dhr = ((*(*(domain as *const *const IDispatchVtbl))).query_interface)(
            domain,
            &IID_IDispatch,
            &mut dispatch,
        );
        if dhr != 0 {
            dispatch = ptr::null_mut();
        }
    }

    Ok(ClrHost {
        host: runtime_host,
        use_new,
        domain: dispatch,
        gate: Mutex::new(()),
    })
}

#[cfg(target_os = "windows")]
struct PipeReadResult {
    bytes: Vec<u8>,
    timeout: bool,
}

#[cfg(target_os = "windows")]
unsafe fn create_pipe(pipe_name: &str) -> *mut c_void {
    let name = wide(&format!(r"\\.\pipe\{}", pipe_name));
    CreateNamedPipeW(
        name.as_ptr(),
        PIPE_ACCESS_INBOUND,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
        1,
        0,
        1024 * 1024,
        0,
        ptr::null(),
    )
}

#[cfg(target_os = "windows")]
struct PipeHandle(*mut c_void);
#[cfg(target_os = "windows")]
unsafe impl Send for PipeHandle {}
#[cfg(target_os = "windows")]
unsafe impl Sync for PipeHandle {}

#[cfg(target_os = "windows")]
fn pipe_reader(
    handle: PipeHandle,
    done: Arc<AtomicBool>,
    result: Arc<Mutex<Option<PipeReadResult>>>,
) {
    let handle = handle.0;
    unsafe {
        let mut connected = ConnectNamedPipe(handle, ptr::null_mut());
        if connected == 0 && GetLastError() == ERROR_PIPE_CONNECTED {
            connected = 1;
        }
        if connected == 0 {
            CloseHandle(handle);
            *result.lock().unwrap() = Some(PipeReadResult {
                bytes: Vec::new(),
                timeout: false,
            });
            done.store(true, Ordering::SeqCst);
            return;
        }

        let mut out = Vec::new();
        loop {
            let mut avail: u32 = 0;
            let ok = PeekNamedPipe(
                handle,
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                &mut avail,
                ptr::null_mut(),
            );
            if ok == 0 {
                let err = GetLastError();
                if err == ERROR_BROKEN_PIPE
                    || err == ERROR_NO_DATA
                    || err == ERROR_OPERATION_ABORTED
                {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
                continue;
            }
            if avail == 0 {
                std::thread::sleep(std::time::Duration::from_millis(10));
                continue;
            }
            let mut buf = vec![0u8; avail as usize];
            let mut read: u32 = 0;
            let ok = ReadFile(handle, buf.as_mut_ptr(), avail, &mut read, ptr::null_mut());
            if ok == 0 {
                break;
            }
            out.extend_from_slice(&buf[..read as usize]);
        }
        DisconnectNamedPipe(handle);
        CloseHandle(handle);
        *result.lock().unwrap() = Some(PipeReadResult {
            bytes: out,
            timeout: false,
        });
        done.store(true, Ordering::SeqCst);
    }
}

pub fn execute_inline(script: &str, timeout_secs: u64) -> String {
    #[cfg(target_os = "windows")]
    {
        let start = std::time::Instant::now();
        let host = match get_clr_host() {
            Ok(h) => h,
            Err(e) => {
                libra_common::dlog!("[psinline] get_clr_host failed: {}", e);
                return format!(r#"{{"success":false,"error":"{e}"}}"#);
            }
        };

        let use_new = host.use_new;
        let _gate = match host.gate.lock() {
            Ok(g) => g,
            Err(e) => {
                libra_common::dlog!("[psinline] clr gate poisoned: {}", e);
                return format!(r#"{{"success":false,"error":"clr gate poisoned: {e}"}}"#);
            }
        };

        let pipe_name = format!("libra_ps_{:016x}", rand_hex());
        let script_b64 = base64_encode(script.as_bytes());
        libra_common::dlog!(
            "[psinline] executing len={} via {} ({}ms)",
            script.len(),
            if use_new {
                "ICLRRuntimeHost"
            } else {
                "IDispatch"
            },
            timeout_secs,
        );

        let handle = unsafe { create_pipe(&pipe_name) };
        if handle.is_null() || handle == -1isize as *mut c_void {
            libra_common::dlog!("[psinline] CreateNamedPipe failed");
            return r#"{"success":false,"error":"CreateNamedPipe failed"}"#.to_string();
        }

        let done = Arc::new(AtomicBool::new(false));
        let result: Arc<Mutex<Option<PipeReadResult>>> = Arc::new(Mutex::new(None));
        let pipe_handle = PipeHandle(handle);
        let reader = {
            let done = done.clone();
            let result = result.clone();
            std::thread::spawn(move || pipe_reader(pipe_handle, done, result))
        };

        let args = format!(
            "{}|{}|{}",
            pipe_name,
            script_b64,
            timeout_secs.max(1) * 1000
        );
        let exec_result = unsafe {
            if host.use_new {
                execute_via_new_interface(host.host, &args)
            } else if !host.domain.is_null() {
                execute_via_legacy_idispatch(host.domain, &args)
            } else {
                Err("no usable CLR execution path".to_string())
            }
        };

        if let Err(e) = exec_result {
            libra_common::dlog!("[psinline] CLR exec failed: {}", e);
            unsafe { CloseHandle(handle) };
            let _ = reader.join();
            return format!(r#"{{"success":false,"error":"{e}"}}"#);
        }
        let exit_code = exec_result.unwrap_or(-1);
        libra_common::dlog!("[psinline] CLR returned exit {}", exit_code);

        let deadline_ms = (timeout_secs.max(1) * 1000) + 30_000;
        let start = std::time::Instant::now();
        let mut timed_out = false;
        loop {
            if done.load(Ordering::SeqCst) {
                break;
            }
            if start.elapsed().as_millis() as u64 >= deadline_ms {
                timed_out = true;
                unsafe { CloseHandle(handle) };
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let _ = reader.join();

        let read = result.lock().unwrap().take().unwrap_or(PipeReadResult {
            bytes: Vec::new(),
            timeout: timed_out,
        });

        if read.timeout || (read.bytes.is_empty() && timed_out) {
            return r#"{"success":false,"error":"inline powershell timed out"}"#.to_string();
        }
        if read.bytes.is_empty() {
            return format!(
                r#"{{"success":false,"error":"stub returned no output (exit {exit_code})"}}"#
            );
        }

        match String::from_utf8(read.bytes) {
            Ok(s) => s,
            Err(e) => format!(r#"{{"success":false,"error":"stub output not utf8: {e}"}}"#),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (script, timeout_secs);
        "[PowerShell not available on this platform]".to_string()
    }
}

#[cfg(target_os = "windows")]
unsafe fn write_stub_temp() -> Option<String> {
    let mut tmp = [0u16; 260];
    let len = GetTempPathW(260, tmp.as_mut_ptr());
    if len == 0 {
        return None;
    }
    let dir = String::from_utf16_lossy(&tmp[..len as usize]);
    let path = format!("{dir}libra_ps_{:016x}.dll", rand_hex());
    if std::fs::write(&path, STUB_DLL).is_err() {
        return None;
    }
    Some(path)
}

#[cfg(target_os = "windows")]
unsafe fn execute_via_new_interface(host: *mut c_void, args: &str) -> Result<i32, String> {
    let stub_path = write_stub_temp().ok_or("write stub temp failed")?;
    let vtbl = &*(*(host as *const *const ICLRRuntimeHostVtbl));
    let mut exit_code: u32 = 0;
    let hr = (vtbl.execute_in_default_app_domain)(
        host,
        wide(&stub_path).as_ptr(),
        wide("PsInline.Stub").as_ptr(),
        wide("Run").as_ptr(),
        wide(args).as_ptr(),
        &mut exit_code,
    );
    let _ = std::fs::remove_file(&stub_path);
    if hr != 0 {
        return Err(format!(
            "ExecuteInDefaultAppDomain failed: 0x{:08X}",
            hr as u32
        ));
    }
    Ok(exit_code as i32)
}

#[cfg(target_os = "windows")]
#[repr(C)]
union VariantData {
    llval: i64,
    ptr: *mut c_void,
    lval: i32,
    boolval: i16,
    decimal: [u8; 16],
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct Variant {
    vt: u16,
    reserved1: u16,
    reserved2: u16,
    reserved3: u16,
    data: VariantData,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct DispParams {
    rgvarg: *mut Variant,
    rgdispid_named_args: *mut i32,
    c_args: u32,
    c_named_args: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct SafeArrayBound {
    c_elements: u32,
    l_lbound: i32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct SafeArray {
    c_dims: u16,
    f_features: u16,
    cb_elements: u32,
    c_locks: u32,
    pv_data: *mut c_void,
    rgsabound: [SafeArrayBound; 1],
}

#[cfg(target_os = "windows")]
const VT_BSTR: u16 = 8;
#[cfg(target_os = "windows")]
const VT_DISPATCH: u16 = 9;
#[cfg(target_os = "windows")]
const VT_UNKNOWN: u16 = 13;
#[cfg(target_os = "windows")]
const VT_UI1: u16 = 17;
#[cfg(target_os = "windows")]
const VT_ARRAY: u16 = 0x2000;
#[cfg(target_os = "windows")]
const VT_BOOL: u16 = 11;
#[cfg(target_os = "windows")]
const VT_I4: u16 = 3;
#[cfg(target_os = "windows")]
const DISPATCH_METHOD: u16 = 0x1;
#[cfg(target_os = "windows")]
const VARIANT_TRUE: i16 = -1;

#[cfg(target_os = "windows")]
#[link(name = "oleaut32")]
extern "system" {
    fn SafeArrayCreateVector(vt: u16, low: i32, count: u32) -> *mut SafeArray;
    fn SafeArrayAccessData(sa: *mut SafeArray, data: *mut *mut c_void) -> i32;
    fn SafeArrayUnaccessData(sa: *mut SafeArray) -> i32;
    fn SafeArrayDestroy(sa: *mut SafeArray) -> i32;
    fn SysAllocString(s: *const u16) -> *mut c_void;
    fn VariantClear(v: *mut Variant) -> i32;
}

#[cfg(target_os = "windows")]
unsafe fn invoke_method(
    obj: *mut c_void,
    dispid: i32,
    args: &mut [Variant],
) -> Result<Variant, String> {
    let vtbl = &*(*(obj as *const *const IDispatchVtbl));
    let params = DispParams {
        rgvarg: if args.is_empty() {
            ptr::null_mut()
        } else {
            args.as_mut_ptr()
        },
        rgdispid_named_args: ptr::null_mut(),
        c_args: args.len() as u32,
        c_named_args: 0,
    };
    let mut result: Variant = std::mem::zeroed();
    let hr = (vtbl.invoke)(
        obj,
        dispid,
        &IID_NULL,
        0,
        DISPATCH_METHOD,
        &params as *const _ as *const c_void,
        &mut result as *mut _ as *mut c_void,
        ptr::null_mut(),
        ptr::null_mut(),
    );
    if hr != 0 {
        return Err(format!(
            "IDispatch::Invoke(0x{dispid:08X}) failed: 0x{:08X}",
            hr as u32
        ));
    }
    Ok(result)
}

#[cfg(target_os = "windows")]
unsafe fn execute_via_legacy_idispatch(domain: *mut c_void, args: &str) -> Result<i32, String> {
    let sa = SafeArrayCreateVector(VT_UI1, 0, STUB_DLL.len() as u32);
    if sa.is_null() {
        return Err("SafeArrayCreateVector failed".into());
    }
    let mut data: *mut c_void = ptr::null_mut();
    if SafeArrayAccessData(sa, &mut data) != 0 {
        SafeArrayDestroy(sa);
        return Err("SafeArrayAccessData failed".into());
    }
    ptr::copy_nonoverlapping(STUB_DLL.as_ptr(), data as *mut u8, STUB_DLL.len());
    SafeArrayUnaccessData(sa);

    let mut load_arg = Variant {
        vt: VT_ARRAY | VT_UI1,
        reserved1: 0,
        reserved2: 0,
        reserved3: 0,
        data: VariantData {
            ptr: sa as *mut c_void,
        },
    };
    let mut load_dispid: Option<i32> = None;
    for name in ["Load_3", "Load", "Load_2"] {
        if let Some(d) = get_dispid(domain, name) {
            load_dispid = Some(d);
            break;
        }
    }
    let load_dispid = load_dispid.ok_or("Load(byte[]) DISPID not found")?;
    let mut assembly = invoke_method(domain, load_dispid, std::slice::from_mut(&mut load_arg))?;
    VariantClear(&mut load_arg);

    let assembly_ptr = match assembly.vt {
        VT_DISPATCH | VT_UNKNOWN => assembly.data.ptr,
        _ => {
            VariantClear(&mut assembly);
            return Err(format!(
                "Load(byte[]) returned unexpected vt={}",
                assembly.vt
            ));
        }
    };
    let mut asm_dispatch: *mut c_void = ptr::null_mut();
    let hr = ((*(*(assembly_ptr as *const *const IDispatchVtbl))).query_interface)(
        assembly_ptr,
        &IID_IDispatch,
        &mut asm_dispatch,
    );
    if hr != 0 || asm_dispatch.is_null() {
        VariantClear(&mut assembly);
        return Err(format!(
            "_Assembly QI IDispatch failed: 0x{:08X}",
            hr as u32
        ));
    }

    let mut create_dispid: Option<i32> = None;
    for name in ["CreateInstance", "CreateInstance_2", "CreateInstance_3"] {
        if let Some(d) = get_dispid(asm_dispatch, name) {
            create_dispid = Some(d);
            break;
        }
    }
    let create_dispid = create_dispid.ok_or("_Assembly CreateInstance DISPID not found")?;

    let type_name_bstr = SysAllocString(wide("PsInline.Stub").as_ptr());
    let mut type_name = Variant {
        vt: VT_BSTR,
        reserved1: 0,
        reserved2: 0,
        reserved3: 0,
        data: VariantData {
            ptr: type_name_bstr,
        },
    };
    let mut instance = invoke_method(
        asm_dispatch,
        create_dispid,
        std::slice::from_mut(&mut type_name),
    )?;
    VariantClear(&mut type_name);
    VariantClear(&mut assembly);

    let instance_ptr = match instance.vt {
        VT_DISPATCH | VT_UNKNOWN => instance.data.ptr,
        _ => {
            VariantClear(&mut instance);
            return Err(format!(
                "CreateInstanceAndUnwrap returned unexpected vt={}",
                instance.vt
            ));
        }
    };
    let mut instance_dispatch: *mut c_void = ptr::null_mut();
    let hr = ((*(*(instance_ptr as *const *const IDispatchVtbl))).query_interface)(
        instance_ptr,
        &IID_IDispatch,
        &mut instance_dispatch,
    );
    if hr != 0 || instance_dispatch.is_null() {
        VariantClear(&mut instance);
        return Err(format!(
            "stub instance QI IDispatch failed: 0x{:08X}",
            hr as u32
        ));
    }

    let run_dispid = get_dispid(instance_dispatch, "Run").ok_or("Run DISPID not found")?;
    let args_bstr = SysAllocString(wide(args).as_ptr());
    let mut args_v = Variant {
        vt: VT_BSTR,
        reserved1: 0,
        reserved2: 0,
        reserved3: 0,
        data: VariantData { ptr: args_bstr },
    };
    let mut result = invoke_method(
        instance_dispatch,
        run_dispid,
        std::slice::from_mut(&mut args_v),
    )?;
    VariantClear(&mut args_v);

    let exit_code = match result.vt {
        VT_I4 => result.data.lval,
        _ => {
            VariantClear(&mut result);
            VariantClear(&mut instance);
            return Err("Run returned non-int result".into());
        }
    };
    VariantClear(&mut result);
    VariantClear(&mut instance);
    Ok(exit_code)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn rand_hex() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let nanos = t.as_nanos() as u64;
    let pid = std::process::id() as u64;
    nanos.rotate_left(16) ^ pid.wrapping_mul(0x9E3779B97F4A7C15)
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(n >> 6) as usize & 63] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[n as usize & 63] as char);
        } else {
            out.push('=');
        }
    }
    out
}
