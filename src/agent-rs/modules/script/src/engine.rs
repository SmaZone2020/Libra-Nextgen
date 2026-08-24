//! Rhai engine construction and script execution with platform API gating.

use rhai::{Dynamic, Engine, Map, Scope, AST};
use rhai::packages::{Package, BasicArrayPackage, BasicMapPackage, BasicStringPackage};
use serde_json::Value;

use super::ifdef::preprocess;
use super::platform_common::register_common_api;

#[cfg(target_os = "windows")]
use super::platform_windows::register_platform_api;
#[cfg(not(target_os = "windows"))]
use super::platform_linux::register_platform_api;

/// Execute a plugin script and return its entry function's return value as a
/// Rhai `Dynamic` (serialized to JSON by the caller).
pub fn execute(
    script: &str,
    args: &Value,
    entry: &str,
    features: &[String],
) -> Result<Dynamic, String> {
    let platform = current_platform();

    // 1. Preprocess #if/#endif — compile-time platform trimming.
    let source = preprocess(script, platform)?;

    // 2. Build a bare engine (no built-ins) and register the gated API.
    let mut engine = Engine::new_raw();
    engine.set_max_expr_depths(64, 32);
    engine.set_max_call_levels(16);
    engine.set_max_operations(100_000);

    register_core_api(&mut engine, platform);
    register_common_api(&mut engine);
    register_platform_api(&mut engine, features);

    // Restore basic Map/Array/String methods (contains/len/keys/...) that
    // `new_raw()` omits, while still excluding print/eval/IO from the sandbox.
    engine.register_global_module(BasicMapPackage::new().as_shared_module());
    engine.register_global_module(BasicArrayPackage::new().as_shared_module());
    engine.register_global_module(BasicStringPackage::new().as_shared_module());

    // 3. Compile.
    let ast: AST = engine
        .compile(&source)
        .map_err(|e| format!("compile error: {}", e))?;

    // 4. Build scope: expose args as a root-level map.
    let mut scope = Scope::new();
    let args_dynamic = json_to_dynamic(args);
    scope.push_dynamic("args", args_dynamic.clone());

    // 5. Invoke the entry function if the script defines one; otherwise treat
    //    the script as a bare expression and evaluate it.
    let entry = if entry.is_empty() { "main" } else { entry };

    match engine.call_fn::<Dynamic>(&mut scope, &ast, entry, (args_dynamic.clone(),)) {
        Ok(v) => Ok(v),
        Err(call_err) => {
            // `main` may not be a function — fall back to evaluating the AST.
            engine
                .eval_ast_with_scope::<Dynamic>(&mut scope, &ast)
                .map_err(|eval_err| {
                    format!("entry '{}' error: {}; top-level error: {}", entry, call_err, eval_err)
                })
        }
    }
}

fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    { "windows" }
    #[cfg(target_os = "linux")]
    { "linux" }
    #[cfg(target_os = "macos")]
    { "macos" }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    { "unknown" }
}

/// Always-on APIs available on every platform.
fn register_core_api(engine: &mut Engine, platform: &str) {
    // A tiny JSON helper namespace: args.xxx accessors are handled by the map
    // itself, but expose a couple of cross-cutting utilities.
    engine.register_fn("len", |s: &str| s.len() as i64);

    // Expose the runtime platform as constants so scripts can also branch at
    // runtime (in addition to the compile-time #if).
    let win = platform == "windows";
    let linux = platform == "linux";
    let macos = platform == "macos";
    engine.register_fn("__platform_windows", move || win);
    engine.register_fn("__platform_linux", move || linux);
    engine.register_fn("__platform_macos", move || macos);
}

/// Recursively convert a serde_json::Value into a Rhai Dynamic.
fn json_to_dynamic(v: &Value) -> Dynamic {
    match v {
        Value::Null => Dynamic::UNIT,
        Value::Bool(b) => Dynamic::from(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Dynamic::from(i)
            } else if let Some(f) = n.as_f64() {
                Dynamic::from(f)
            } else {
                Dynamic::from(n.to_string())
            }
        }
        Value::String(s) => Dynamic::from(s.clone()),
        Value::Array(arr) => {
            let items: Vec<Dynamic> = arr.iter().map(json_to_dynamic).collect();
            Dynamic::from(items)
        }
        Value::Object(obj) => {
            let mut map = Map::new();
            for (k, val) in obj {
                map.insert(k.clone().into(), json_to_dynamic(val));
            }
            Dynamic::from(map)
        }
    }
}
