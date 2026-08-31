//!
//! MimoCode / CodeX / Gemini / OpenClaw / Hermes / CC Switch / DeepSeek
//!
//!   module_name() -> *const u8
//!   module_main(input, input_len, output, output_cap) -> usize

mod ai_token_scanner;

#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("aitoken", "\0").as_ptr() as *const u8
}

#[no_mangle]
pub unsafe extern "system" fn module_main(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_cap: usize,
) -> usize {
    let _ = (input, input_len);
    let result = ai_token_scanner::AITokenScanner::scan();
    write_output(&result, output, output_cap)
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
