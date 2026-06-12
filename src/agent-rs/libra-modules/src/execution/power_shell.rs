pub struct PowerShellRunner;

impl PowerShellRunner {
    /// Execute PowerShell script via powershell.exe (Native AOT compatible).
    /// Rust doesn't have a PowerShell Runspace API — always fall back to process.
    pub async fn execute(script: &str) -> String {
        execute_via_process(script).await
    }
}

async fn execute_via_process(script: &str) -> String {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD
        .encode(script.encode_utf16().flat_map(|c| c.to_le_bytes()).collect::<Vec<u8>>());

    #[cfg(target_os = "windows")]
    {
        let output = tokio::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                &encoded,
            ])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output()
            .await;

        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                let stderr = String::from_utf8_lossy(&o.stderr);
                if stdout.trim().is_empty() && stderr.trim().is_empty() {
                    "[PowerShell completed with no output]".to_string()
                } else if !stderr.trim().is_empty() {
                    format!("{}\n[STDERR]\n{}", stdout.trim_end(), stderr.trim_end())
                } else {
                    stdout.trim_end().to_string()
                }
            }
            Err(e) => format!("[Failed to start PowerShell process: {}]", e),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("[PowerShell not available on this platform: {} chars]", encoded.len())
    }
}
