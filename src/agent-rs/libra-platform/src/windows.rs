use std::pin::Pin;
use std::future::Future;
use tokio::process::Command;
use tokio::sync::watch;
use crate::platform::{IPlatformExecutor, InteractiveShellHandle};

pub struct WindowsExecutor;

impl WindowsExecutor {
    pub fn new() -> Self {
        Self
    }
}

impl IPlatformExecutor for WindowsExecutor {
    fn get_default_shell(&self) -> &str {
        "cmd.exe"
    }

    fn is_available(&self) -> bool {
        cfg!(target_os = "windows")
    }

    fn execute(
        &self,
        command: &str,
    ) -> Pin<Box<dyn Future<Output = String> + Send + '_>> {
        let command = command.to_string();
        Box::pin(async move {
            let output = Command::new("cmd.exe")
                .args(["/c", &command])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                .await;

            match output {
                Ok(out) => {
                    let stdout = crate::decode_shell_bytes(&out.stdout);
                    let stderr = crate::decode_shell_bytes(&out.stderr);
                    if stdout.is_empty() { stderr } else { stdout }
                }
                Err(e) => format!("Failed to start process: {}", e),
            }
        })
    }

    fn start_interactive_shell(&self) -> InteractiveShellHandle {
        use std::process::Stdio;

        let (cancel_tx, _) = watch::channel(false);
        let child = Command::new("cmd.exe")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir("C:\\")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .expect("Failed to start cmd.exe");

        InteractiveShellHandle { child, cancel_tx }
    }

    fn get_drives(&self) -> Vec<String> {
        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            if std::path::Path::new(&path).exists() {
                drives.push(path);
            }
        }
        drives
    }
}
