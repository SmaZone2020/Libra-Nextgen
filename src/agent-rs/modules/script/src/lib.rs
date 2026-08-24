//! Script module — executes Rhai plugin scripts inside the agent.
//!
//! This is the "no-compiler" plugin path: plugin authors ship a `.rhai` text
//! source instead of a compiled cdylib. The script runs in a sandboxed Rhai
//! engine whose API surface is gated by (a) the platform and (b) an optional
//! feature allowlist, with C#-MAUI-style `#if(WINDOWS)/#endif` conditional
//! compilation resolved at parse time.
//!
//! ABI (same as every cloud module, see `libra-load`):
//! ```text
//! module_name() -> *const u8
//! module_main(input: *const u8, input_len: usize,
//!             output: *mut u8, output_cap: usize) -> usize
//! ```
//!
//! Input JSON: `{"script":"...", "args":{...}, "entry":"main", "features":[...]}`
//! Output: the entry function's return value, serialized as JSON.

mod engine;
mod ifdef;
#[cfg(target_os = "windows")]
mod platform_windows;
#[cfg(not(target_os = "windows"))]
mod platform_linux;

use serde_json::Value;

/// Self-identification name (must match the module name requested by the agent).
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("script", "\0").as_ptr() as *const u8
}

/// Entry point. Parses the request, runs the script, writes JSON output.
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

    let result = run_script(&input_json);
    write_output(&result, output, output_cap)
}

fn run_script(input_json: &str) -> String {
    let req: Value = serde_json::from_str(input_json).unwrap_or(Value::Object(Default::default()));

    let script = req
        .get("script")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if script.is_empty() {
        return serde_json::json!({ "error": "missing script" }).to_string();
    }

    let args: Value = req.get("args").cloned().unwrap_or(Value::Object(Default::default()));
    let entry = req
        .get("entry")
        .and_then(|v| v.as_str())
        .unwrap_or("main")
        .to_string();

    let features: Vec<String> = req
        .get("features")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    engine::execute(&script, &args, &entry, &features)
        .map(|v| serde_json::json!({ "ok": true, "result": v }).to_string())
        .unwrap_or_else(|e| serde_json::json!({ "ok": false, "error": e }).to_string())
}

fn write_output(s: &str, output: *mut u8, output_cap: usize) -> usize {
    let bytes = s.as_bytes();
    let n = bytes.len().min(output_cap);
    if n > 0 && !output.is_null() {
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n); }
    }
    n
}
