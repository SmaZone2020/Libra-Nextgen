use std::process::Command;

pub struct ShellCommand;

impl ShellCommand {
    pub async fn execute(command: &str, timeout_ms: u64) -> String {
        let cmd = command.to_string();
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(timeout_ms),
            tokio::task::spawn_blocking(move || execute_sync(&cmd)),
        )
        .await;

        match result {
            Ok(Ok(Ok(output))) => output,
            Ok(Ok(Err(e))) => e,
            Ok(Err(_join_err)) => "Process panicked".to_string(),
            Err(_) => "Command timed out".to_string(),
        }
    }
}

fn execute_sync(command: &str) -> Result<String, String> {
    let (shell, arg) = get_shell_and_arg(command);

    let mut cmd = Command::new(&shell);
    cmd.arg(&arg)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if stdout.trim().is_empty() && !stderr.trim().is_empty() {
        Ok(stderr.to_string())
    } else if !stdout.trim().is_empty() && !stderr.trim().is_empty() {
        Ok(format!("{}\n{}", stdout, stderr))
    } else {
        Ok(stdout.to_string())
    }
}

fn get_shell_and_arg(command: &str) -> (String, String) {
    #[cfg(target_os = "windows")]
    {
        ("cmd.exe".into(), format!("/c {}", command))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = detect_unix_shell();
        (shell, format!("-c \"{}\"", command.replace('"', "\\\"")))
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_unix_shell() -> String {
    for shell in &["/bin/bash", "/bin/zsh", "/bin/sh"] {
        if std::path::Path::new(shell).exists() {
            return shell.to_string();
        }
    }
    "/bin/sh".into()
}
