//! rquickjs (QuickJS) engine construction and script execution with platform
//! API gating. The runtime is deliberately bare: no timers, no fetch, no
//! eval/Function (deleted from the global object), no host object prototypes.
//! The exposed API is the allowlist registered in `api_common`/`api_windows`/
//! `api_linux`, nothing else.

use rquickjs::{Ctx, Function, Runtime, Value};
use serde_json::Value as JsonValue;

use super::api_common::register_common_api;
use super::api_linux::register_linux_api;
use super::api_windows::register_windows_api;

/// Execute a plugin script and return its entry function's return value as a
/// serde_json::Value (serialized to JSON by the caller).
pub fn execute(
    script: &str,
    args: &JsonValue,
    entry: &str,
    features: &[String],
) -> Result<JsonValue, String> {
    let platform = current_platform();

    // 1. Bare runtime.
    let runtime = Runtime::new().map_err(|e| format!("runtime init failed: {}", e))?;
    let context =
        rquickjs::Context::full(&runtime).map_err(|e| format!("context init failed: {}", e))?;

    context.with(|ctx| {
        // 2. Strip escape hatches (a sandboxed script must not eval new code).
        drop_globals(&ctx);

        // 3. Register the gated API surface.
        register_common_api(&ctx, platform);
        if platform == "windows" {
            register_windows_api(&ctx, features);
        } else {
            register_linux_api(&ctx, features);
        }

        // 4. Evaluate the script source (defines the entry function).
        ctx.eval::<(), _>(script)
            .map_err(|e| format!("script error: {}", e))?;

        // 5. Resolve the entry function (default "main").
        let entry_name = if entry.is_empty() { "main" } else { entry };
        let func: Function = ctx.globals().get(entry_name).map_err(|_| {
            format!(
                "entry function '{}' not found (script must define `function {}`)",
                entry_name, entry_name
            )
        })?;

        // 6. Invoke with the deserialized args object.
        let args_js = json_to_js(&ctx, args)?;
        let result: Value = func
            .call((args_js,))
            .map_err(|e| format!("entry '{}' error: {}", entry_name, e))?;

        // 7. Convert the JS return value back to JSON.
        js_to_json(&ctx, &result)
    })
}

/// Recursively convert a serde_json::Value into a JS value using only the
/// primitive constructors (bool / int / float / string) and Object/Array.
fn json_to_js<'js>(ctx: &Ctx<'js>, v: &JsonValue) -> Result<Value<'js>, String> {
    let js: rquickjs::Value = match v {
        JsonValue::Null => rquickjs::Value::new_null(ctx.clone()),
        JsonValue::Bool(b) => rquickjs::Value::new_bool(ctx.clone(), *b),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                if let Ok(i32v) = i32::try_from(i) {
                    rquickjs::Value::new_int(ctx.clone(), i32v)
                } else {
                    rquickjs::Value::new_float(ctx.clone(), i as f64)
                }
            } else if let Some(f) = n.as_f64() {
                rquickjs::Value::new_float(ctx.clone(), f)
            } else {
                rquickjs::Value::new_float(ctx.clone(), n.to_string().parse::<f64>().unwrap_or(0.0))
            }
        }
        JsonValue::String(s) => rquickjs::String::from_str(ctx.clone(), s)
            .map_err(|e| e.to_string())?
            .into_value(),
        JsonValue::Array(items) => {
            let arr = rquickjs::Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (i, item) in items.iter().enumerate() {
                arr.set(i, json_to_js(ctx, item)?)
                    .map_err(|e| e.to_string())?;
            }
            arr.into_value()
        }
        JsonValue::Object(map) => {
            let obj = rquickjs::Object::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (k, val) in map {
                obj.set(k.as_str(), json_to_js(ctx, val)?)
                    .map_err(|e| e.to_string())?;
            }
            obj.into_value()
        }
    };
    Ok(js)
}

/// Recursively convert a JS value into a serde_json::Value. Undefined/null →
/// null; bool → bool; number → f64 (i64 when integral); string → string;
/// arrays/objects recurse; anything else → its string form.
fn js_to_json(ctx: &Ctx, v: &Value) -> Result<JsonValue, String> {
    if v.is_null() || v.is_undefined() {
        return Ok(JsonValue::Null);
    }
    if let Some(b) = v.as_bool() {
        return Ok(JsonValue::Bool(b));
    }
    if let Some(n) = v.as_number() {
        let f = n;
        if f.fract() == 0.0 && f >= i64::MIN as f64 && f <= i64::MAX as f64 {
            return Ok(JsonValue::from(f as i64));
        }
        return Ok(JsonValue::from(f));
    }
    if v.is_string() {
        let s: String = v.get().map_err(|e| e.to_string())?;
        return Ok(JsonValue::String(s));
    }
    if let Some(arr) = v.as_array() {
        let mut out = Vec::with_capacity(arr.len());
        for item in arr.iter::<Value>() {
            let item = item.map_err(|e| e.to_string())?;
            out.push(js_to_json(ctx, &item)?);
        }
        return Ok(JsonValue::Array(out));
    }
    if let Some(obj) = v.as_object() {
        let mut map = serde_json::Map::new();
        for key in obj.keys::<String>() {
            let key = key.map_err(|e| e.to_string())?;
            let val: Value = obj.get(&key).map_err(|e| e.to_string())?;
            map.insert(key, js_to_json(ctx, &val)?);
        }
        return Ok(JsonValue::Object(map));
    }
    // Symbols / functions / host objects — represent as strings.
    Ok(JsonValue::String(format!("<{}>", v.type_name())))
}

fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        "unknown"
    }
}

/// Remove escape hatches from the global object so a plugin script cannot
/// self-extend the sandbox. `eval`/`Function` are host functions; removing
/// them makes code evaluation impossible.
fn drop_globals(ctx: &Ctx) {
    let globals = ctx.globals();
    for name in ["eval", "Function", "gc", "print"] {
        let _ = globals.remove(name);
    }
}
