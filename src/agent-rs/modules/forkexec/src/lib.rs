//! `forkexec` cloud module — execute OS programs in a fresh child process
//! (fork-and-run) via `libra-platform::process::ProcessExecutor`, isolated
//! from the agent process: a crashing/hanging child cannot take the agent
//! down, output is piped back, and detached daemons are reaped automatically.
//!
//! ABI (shared with `libra-load`):
//! ```text
//! unsafe extern "system" fn module_main(
//!     input: *const u8, input_len: usize,
//!     output: *mut u8, output_cap: usize,
//! ) -> usize
//! ```
//!
//! Input JSON:
//! ```json
//! { "op": "run", "program": "/bin/ls", "args": ["-la"],
//!   "env": {"K": "V"}, "cwd": "/tmp", "timeoutSeconds": 30 }
//! { "op": "spawn", "program": "notepad.exe", "args": [], "env": {}, "cwd": null }
//! ```
//! Output JSON:
//! ```json
//! { "success": true, "exitCode": 0, "stdout": "...", "stderr": "...", "timedOut": false }
//! { "success": true, "pid": 1234 }
//! ```

use std::io::Read;
use std::time::Duration;

use libra_platform::process::{ExitStatus, ProcessExecutor};
use serde_json::{json, Value};

const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// Entry point invoked by the module manager. Writes JSON result into `output`,
/// returns the number of bytes written (0 on error).
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("forkexec", "\0").as_ptr() as *const u8
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
    let bytes = result.as_bytes();
    let n = bytes.len().min(output_cap);
    if n > 0 && !output.is_null() {
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n) };
    }
    n
}

fn dispatch(input: &str) -> String {
    let v: Value = serde_json::from_str(input).unwrap_or(Value::Object(Default::default()));
    let op = v.get("op").and_then(|o| o.as_str()).unwrap_or("run");
    match op {
        "spawn" => spawn(&v),
        "run" => run(&v),
        other => err(&format!("unknown forkexec op '{other}'")),
    }
}

/// Build the executor from the request payload (program/args/env/cwd).
fn build_executor(v: &Value) -> Result<ProcessExecutor, String> {
    let program = v
        .get("program")
        .and_then(|p| p.as_str())
        .filter(|p| !p.is_empty())
        .ok_or_else(|| "program is required".to_string())?;

    let mut exe = ProcessExecutor::new(program);

    if let Some(args) = v.get("args").and_then(|a| a.as_array()) {
        for a in args {
            if let Some(s) = a.as_str() {
                exe.arg(s);
            }
        }
    }
    if let Some(env) = v.get("env").and_then(|e| e.as_object()) {
        for (k, val) in env {
            if let Some(s) = val.as_str() {
                exe.env(k, s);
            }
        }
    }
    if let Some(cwd) = v
        .get("cwd")
        .and_then(|c| c.as_str())
        .filter(|c| !c.is_empty())
    {
        exe.current_dir(cwd);
    }
    Ok(exe)
}

/// Run a program to completion (with timeout) and return its output.
fn run(v: &Value) -> String {
    let exe = match build_executor(v) {
        Ok(e) => e,
        Err(e) => return err(&e),
    };
    let timeout_secs = v
        .get("timeoutSeconds")
        .and_then(|t| t.as_u64())
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .max(1);

    // Spawn manually so we can enforce the timeout with kill, then drain the
    // pipes on worker threads (a chatty child must not deadlock on a full
    // pipe buffer while we wait).
    let mut child = match exe.spawn() {
        Ok(c) => c,
        Err(e) => return err(&format!("spawn failed: {e}")),
    };

    let stdout = child
        .take_stdout()
        .map(|f| std::thread::spawn(move || read_all(f)));
    let stderr = child
        .take_stderr()
        .map(|f| std::thread::spawn(move || read_all(f)));

    let (timed_out, status) = match child.wait_timeout(Duration::from_secs(timeout_secs)) {
        Ok(Some(status)) => (false, status),
        Ok(None) => {
            // Hard kill; SIGKILL/TerminateProcess cannot be trapped.
            let _ = child.kill();
            let status = child.wait().unwrap_or(ExitStatus::new(130));
            (true, status)
        }
        Err(e) => return err(&format!("wait failed: {e}")),
    };

    let stdout = stdout.and_then(|h| h.join().ok()).unwrap_or_default();
    let stderr = stderr.and_then(|h| h.join().ok()).unwrap_or_default();

    json!({
        "success": !timed_out && status.success(),
        "exitCode": status.code(),
        "stdout": String::from_utf8_lossy(&stdout).into_owned(),
        "stderr": String::from_utf8_lossy(&stderr).into_owned(),
        "timedOut": timed_out,
    })
    .to_string()
}

/// Spawn a detached background process (daemon mode) and return its PID.
/// The zombie reaper inside ProcessExecutor collects it when it exits.
fn spawn(v: &Value) -> String {
    let mut exe = match build_executor(v) {
        Ok(e) => e,
        Err(e) => return err(&e),
    };
    exe.detached(true);

    match exe.spawn() {
        Ok(child) => json!({ "success": true, "pid": child.pid() }).to_string(),
        Err(e) => err(&format!("spawn failed: {e}")),
    }
}

fn read_all(mut f: std::fs::File) -> Vec<u8> {
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    buf
}

fn err(message: &str) -> String {
    json!({ "success": false, "error": message }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_json(v: &Value) -> Value {
        serde_json::from_str(&dispatch(&v.to_string())).unwrap()
    }

    #[test]
    fn run_captures_output() {
        #[cfg(windows)]
        let v = json!({ "op": "run", "program": "cmd", "args": ["/C", "echo", "hello"] });
        #[cfg(not(windows))]
        let v = json!({ "op": "run", "program": "/bin/echo", "args": ["hello"] });

        let out = run_json(&v);
        assert_eq!(out["success"], true);
        assert_eq!(out["exitCode"], 0);
        assert!(out["stdout"].as_str().unwrap().contains("hello"));
        assert_eq!(out["timedOut"], false);
    }

    #[test]
    fn run_applies_env_and_cwd() {
        #[cfg(windows)]
        let v = json!({
            "op": "run", "program": "cmd",
            "args": ["/C", "echo", "%LIBRA_FE_TEST%"],
            "env": { "LIBRA_FE_TEST": "from-env" }
        });
        #[cfg(not(windows))]
        let v = json!({
            "op": "run", "program": "/bin/sh",
            "args": ["-c", "echo \"$LIBRA_FE_TEST\""],
            "env": { "LIBRA_FE_TEST": "from-env" }
        });

        let out = run_json(&v);
        assert_eq!(out["success"], true);
        assert!(out["stdout"].as_str().unwrap().contains("from-env"));
    }

    #[test]
    fn run_timeout_kills_child() {
        #[cfg(windows)]
        let v = json!({ "op": "run", "program": "cmd", "args": ["/C", "ping", "-n", "31", "127.0.0.1", ">nul"], "timeoutSeconds": 1 });
        #[cfg(not(windows))]
        let v = json!({ "op": "run", "program": "/bin/sh", "args": ["-c", "sleep 30"], "timeoutSeconds": 1 });

        let out = run_json(&v);
        assert_eq!(out["timedOut"], true);
        assert_eq!(out["success"], false);
        assert_ne!(out["exitCode"], 0);
    }

    #[test]
    fn spawn_detached_returns_pid() {
        #[cfg(windows)]
        let v = json!({ "op": "spawn", "program": "cmd", "args": ["/C", "timeout", "/t", "1", "/nobreak", ">nul"] });
        #[cfg(not(windows))]
        let v = json!({ "op": "spawn", "program": "/bin/sleep", "args": ["1"] });

        let out = run_json(&v);
        assert_eq!(out["success"], true);
        let pid = out["pid"].as_u64().expect("pid returned");
        assert!(pid > 0);
    }

    #[test]
    fn missing_program_is_an_error() {
        let v = json!({ "op": "run", "program": "definitely-not-a-real-binary-xyz" });
        let out = run_json(&v);
        assert_eq!(out["success"], false);
        // Windows reports a localized ERROR_FILE_NOT_FOUND; Linux reports
        // "not found in PATH" — either way spawn must fail with a message.
        let error = out["error"].as_str().unwrap();
        assert!(
            error.contains("failed") || error.contains("not found"),
            "{error}"
        );
    }

    #[test]
    fn unknown_op_is_an_error() {
        let v = json!({ "op": "nope", "program": "cmd" });
        let out = run_json(&v);
        assert_eq!(out["success"], false);
    }
}
