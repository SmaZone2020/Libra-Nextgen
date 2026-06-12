use tokio::process::Command;

pub struct ShellCommand;

impl ShellCommand {
    pub async fn execute(command: &str, timeout_ms: u64) -> String {
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(timeout_ms),
            Self::execute_inner(command),
        )
        .await;

        match result {
            Ok(output) => output,
            Err(_) => "Command timed out".to_string(),
        }
    }

    async fn execute_inner(command: &str) -> String {
        let (shell, arg) = get_shell_and_arg(command);

        let output = match Command::new(&shell)
            .arg(&arg)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output()
            .await
        {
            Ok(o) => o,
            Err(e) => return format!("Failed to start process: {}", e),
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        if stdout.trim().is_empty() {
            stderr.to_string()
        } else {
            stdout.to_string()
        }
    }
}

fn get_shell_and_arg(command: &str) -> (String, String) {
    #[cfg(target_os = "windows")]
    {
        ("cmd.exe".into(), format!("/c {}", command))
    }
    #[cfg(not(target_os = "windows"))]
    {
        ("/bin/bash".into(), format!("-c \"{}\"", command.replace('"', "\\\"")))
    }
}
