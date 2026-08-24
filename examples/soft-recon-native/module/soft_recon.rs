//! 插件 Agent 端模块示例（某软件信息探测）。
//!
//! 编译为 cdylib（.dll/.so），导出两个符号供 `libra-load` 内存加载：
//!   - `module_name` -> 返回模块名（必须等于 meta.json 里 module.name）
//!   - `module_main`  -> stdcall ABI 入口，收 JSON 输入，写 JSON 输出
//!
//! 输入 JSON 形如 {"op":"probe","target":"..."}；输出任意 JSON 字符串，
//! 由 Agent 的 ModuleManager 回传给服务端。

use std::ffi::CStr;

/// 模块自识别名。Agent 加载后会校验此名与请求名一致。
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    b"soft_recon\0".as_ptr()
}

/// 主入口：`input` 为 JSON 字节，`output` 为回填缓冲区，返回写入字节数。
///
/// # Safety
/// 由宿主（libra-load）调用，指针与长度必须有效。
#[no_mangle]
pub unsafe extern "system" fn module_main(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_cap: usize,
) -> usize {
    let input_slice = std::slice::from_raw_parts(input, input_len);
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(input_slice) else {
        return write_out(output, output_cap, br#"{"error":"invalid json input"}"#);
    };

    let op = json.get("op").and_then(|v| v.as_str()).unwrap_or("");
    let target = json.get("target").and_then(|v| v.as_str()).unwrap_or("");

    let result = match op {
        "probe" => serde_json::json!({
            "status": "ok",
            "module": "soft_recon",
            "target": target,
            "findings": [
                {"type": "version", "value": "3.9.7"},
                {"type": "session", "value": "active"},
            ]
        }),
        _ => serde_json::json!({ "error": "unknown op", "op": op }),
    };

    let bytes = result.to_string();
    write_out(output, output_cap, bytes.as_bytes())
}

fn write_out(output: *mut u8, cap: usize, bytes: &[u8]) -> usize {
    if bytes.len() > cap {
        return 0;
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, bytes.len());
    }
    bytes.len()
}

/// 供插件作者参考：从 C 字符串读取的辅助函数（示例，未使用）。
#[allow(dead_code)]
unsafe fn cstr_to_string(ptr: *const u8) -> String {
    if ptr.is_null() {
        return String::new();
    }
    CStr::from_ptr(ptr as *const i8).to_string_lossy().into_owned()
}
