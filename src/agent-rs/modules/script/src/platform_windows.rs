//! Windows platform API for script plugins.
//!
//! Registered into the Rhai engine only when running on Windows, so a script
//! that references any of these functions is guaranteed to run only on Windows
//! (on Linux it fails to compile with "function not found").
//!
//! The API surface is a curated allowlist, gated by features:
//!   - `core` (always on): `sys.cmd`, `sys.powershell`, `sys.reg_query`, `reg_set`
//!   - `full` (opt-in): deep Win32 (deliberately not wired — see §security)

use rhai::Engine;
use std::process::Command;

pub fn register_platform_api(engine: &mut Engine, features: &[String]) {
    // ── sys.cmd(cmdline) -> String ─────────────────────────────────────
    engine.register_fn("cmd", run_cmd_external);

    // ── sys.powershell(script) -> String ──────────────────────────────
    engine.register_fn("powershell", powershell);

    // ── sys.reg_query(key, name) -> String ────────────────────────────
    engine.register_fn("reg_query", reg_query);

    // ── sys.reg_set(key, name, data) -> bool ──────────────────────────
    engine.register_fn("reg_set", reg_set);

    if features.iter().any(|f| f == "full") {
        register_full_api(engine);
    }
}

/// `sys.cmd("...")` — run a command via `cmd /C`, return stdout (stderr if
/// stdout is empty), prefixed with nothing.
fn run_cmd_external(cmdline: &str) -> String {
    run("cmd", &["/C", cmdline])
}

fn powershell(script: &str) -> String {
    run("powershell", &["-NoProfile", "-NonInteractive", "-Command", script])
}

fn reg_query(key: &str, name: &str) -> String {
    run("reg", &["query", key, "/v", name])
}

fn reg_set(key: &str, name: &str, data: &str) -> bool {
    let out = Command::new("reg")
        .args(["add", key, "/v", name, "/d", data, "/f"])
        .output();
    matches!(out, Ok(o) if o.status.success())
}

/// Run a program, returning stdout (falling back to stderr) as a string.
fn run(program: &str, args: &[&str]) -> String {
    match Command::new(program).args(args).output() {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&o.stderr).into_owned();
            if stdout.trim().is_empty() { stderr } else { stdout }
        }
        Err(e) => format!("failed to spawn {}: {}", program, e),
    }
}

/// Opt-in deep APIs. Deliberately NOT a general FFI escape hatch. Wiring
/// arbitrary Win32 calls needs a per-call signature + marshalling scheme;
/// extending this is a deliberate, reviewed change, not a generic hook.
fn register_full_api(engine: &mut Engine) {
    engine.register_fn("__winapi_reserved", || "winapi full-stack not yet wired");
}
