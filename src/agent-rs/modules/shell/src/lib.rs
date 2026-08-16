//! Shell execution module — cloud-loaded on demand by the agent.
//!
//! ABI (shared with `libra-load`):
//! ```text
//! unsafe extern "system" fn module_main(
//!     input: *const u8, input_len: usize,
//!     output: *mut u8, output_cap: usize,
//! ) -> usize
//! ```
//!
//! Input JSON:  `{"command":"...","timeoutSeconds":60}`
//! Output JSON: `{"success":true,"output":"..."}`

use serde_json::Value;

const DEFAULT_TIMEOUT: u64 = 60;

/// Entry point invoked by the module manager. Writes JSON result into `output`,
/// returns the number of bytes written (0 on error).
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

    let result = run(&input_json);
    let bytes = result.as_bytes();
    let n = bytes.len().min(output_cap);
    if n > 0 && !output.is_null() {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n);
    }
    n
}

/// Parse the request and execute the command. Returns a JSON result string.
fn run(input_json: &str) -> String {
    let parsed: Value = serde_json::from_str(input_json).unwrap_or(Value::Object(Default::default()));
    let command = parsed
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or(input_json)
        .to_string();
    let timeout = parsed
        .get("timeoutSeconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_TIMEOUT)
        .max(1);

    let (success, output) = execute(&command, timeout);

    serde_json::json!({ "success": success, "output": output }).to_string()
}

/// Execute a command through the platform shell and collect its output.
fn execute(command: &str, timeout_secs: u64) -> (bool, String) {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(command);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = std::process::Command::new("/bin/sh");
        c.arg("-c").arg(command);
        c
    };

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return (false, format!("spawn failed: {}", e)),
    };

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = child
                    .stdout
                    .take()
                    .map(read_all)
                    .unwrap_or_default();
                let stderr = child
                    .stderr
                    .take()
                    .map(read_all)
                    .unwrap_or_default();
                let output = if stdout.trim().is_empty() { stderr } else { stdout };
                return (status.success(), output);
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return (false, "command timed out".to_string());
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Err(e) => return (false, format!("wait failed: {}", e)),
        }
    }
}

fn read_all<R: std::io::Read>(mut r: R) -> String {
    let mut buf = String::new();
    let _ = r.read_to_string(&mut buf);
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_echo_returns_output() {
        #[cfg(target_os = "windows")]
        let command = "echo hello-from-shell-module";
        #[cfg(not(target_os = "windows"))]
        let command = "echo hello-from-shell-module";

        let result = run(&serde_json::json!({ "command": command }).to_string());
        let parsed: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(parsed["success"], true);
        assert!(parsed["output"].as_str().unwrap().contains("hello-from-shell-module"));
    }

    #[test]
    fn run_invalid_command_reports_failure() {
        #[cfg(target_os = "windows")]
        let command = "nonexistent-command-xyz-12345";
        #[cfg(not(target_os = "windows"))]
        let command = "nonexistent-command-xyz-12345";

        let result = run(&serde_json::json!({ "command": command }).to_string());
        let parsed: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["success"], false);
    }
}
