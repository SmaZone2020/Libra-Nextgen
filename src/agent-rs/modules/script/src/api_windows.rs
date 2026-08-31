//! Windows platform API for script plugins.
//!
//! Registered into the JS runtime only when running on Windows, so a script
//! that references any of these functions is guaranteed to run only on Windows
//! (elsewhere calling them throws "not a function").
//!
//! The API surface is a curated allowlist, gated by features:
//!   - `core` (always on): `cmd`, `powershell`, `reg_query`, `reg_set`,
//!     `reg_delete`, `ipconfig`, `wmic`, `tasklist`
//!   - `full` (opt-in): deep Win32 (deliberately not wired — see §security)

use rquickjs::{Ctx, Function};
use std::process::Command;

pub fn register_windows_api(ctx: &Ctx, features: &[String]) {
    let globals = ctx.globals();
    let _ = globals.set("cmd", Function::new(ctx.clone(), run_cmd));
    let _ = globals.set("powershell", Function::new(ctx.clone(), powershell));

    let _ = globals.set("reg_query", Function::new(ctx.clone(), reg_query));
    let _ = globals.set("reg_set", Function::new(ctx.clone(), reg_set));
    let _ = globals.set("reg_delete", Function::new(ctx.clone(), reg_delete));

    let _ = globals.set(
        "ipconfig",
        Function::new(ctx.clone(), || -> String { run("ipconfig", &["/all"]) }),
    );
    let _ = globals.set(
        "wmic",
        Function::new(ctx.clone(), |query: String| -> String {
            run("wmic", &[query.as_str()])
        }),
    );
    let _ = globals.set(
        "tasklist",
        Function::new(ctx.clone(), || -> String {
            run("tasklist", &["/FO", "LIST"])
        }),
    );

    if features.iter().any(|f| f == "full") {
        let _ = globals.set(
            "__winapi_reserved",
            Function::new(ctx.clone(), || "winapi full-stack not yet wired"),
        );
    }
}

fn run_cmd(cmdline: String) -> String {
    run("cmd", &["/C", cmdline.as_str()])
}

fn powershell(script: String) -> String {
    libra_psinline::execute_inline(&script, 60)
}

fn reg_query(key: String, name: String) -> String {
    run("reg", &["query", key.as_str(), "/v", name.as_str()])
}

fn reg_set(key: String, name: String, data: String) -> bool {
    Command::new("reg")
        .args([
            "add",
            key.as_str(),
            "/v",
            name.as_str(),
            "/d",
            data.as_str(),
            "/f",
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn reg_delete(key: String, name: String) -> bool {
    Command::new("reg")
        .args(["delete", key.as_str(), "/v", name.as_str(), "/f"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Run a program, returning stdout (falling back to stderr) as a string.
fn run(program: &str, args: &[&str]) -> String {
    match Command::new(program).args(args).output() {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&o.stderr).into_owned();
            if stdout.trim().is_empty() {
                stderr
            } else {
                stdout
            }
        }
        Err(e) => format!("failed to spawn {}: {}", program, e),
    }
}
