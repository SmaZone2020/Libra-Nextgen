//! Script module — executes plugin scripts inside the agent.
//!
//! This is the "no-compiler" plugin path: plugin authors ship a `.js` text
//! source instead of a compiled cdylib. The script runs in a sandboxed
//! QuickJS (rquickjs) runtime whose API surface is gated by (a) the platform
//! and (b) an optional feature allowlist. Platform branching is done at
//! runtime via `__platform()` (there is no compile-time preprocessor anymore).
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
//!
//! Script contract:
//!   - the script must define a function named `entry` (default `main`) that
//!     receives the deserialized `args` object and returns a JSON-serializable
//!     value;
//!   - the JS globals `fs`/`proc`/`env` and the functions `whoami()`/`log()`
//!     plus platform command helpers (`cmd`, `powershell`, `reg_query`, … on
//!     Windows; `shell`, `bash`, `uname`, … elsewhere) are always available;
//!   - `__platform()` returns "windows" | "linux" | "macos" | "unknown".

mod api_common;
mod api_linux;
mod api_windows;
mod engine;

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

    let args: Value = req
        .get("args")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));
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
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n);
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_script_returns_map() {
        let script = r#"
function main(args) {
    const op = args.op || "showcase";
    if (op === "shell") {
        return { command: args.command, output: "OK" };
    }
    return { other: true };
}
"#;
        let out = run_script(
            &serde_json::json!({
                "script": script,
                "args": { "op": "shell", "command": "whoami" },
                "entry": "main",
                "features": []
            })
            .to_string(),
        );
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true);
        assert!(
            v["result"].is_object(),
            "result should be object, got {:?}",
            v["result"]
        );
        assert_eq!(v["result"]["output"], "OK");
    }

    #[test]
    fn missing_entry_falls_back_to_main() {
        let out = run_script(
            &serde_json::json!({
                "script": "function main() { return { hello: 1 }; }",
                "args": {},
                "features": []
            })
            .to_string(),
        );
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["result"]["hello"], 1);
    }
}
