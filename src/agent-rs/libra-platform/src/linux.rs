use std::pin::Pin;
use std::future::Future;
use tokio::process::Command;
use tokio::sync::watch;
use crate::platform::{IPlatformExecutor, InteractiveShellHandle};

pub struct LinuxExecutor {
    shell: String,
}

impl LinuxExecutor {
    pub fn new() -> Self {
        let shell = if std::path::Path::new("/bin/bash").exists() {
            "/bin/bash".into()
        } else if std::path::Path::new("/bin/zsh").exists() {
            "/bin/zsh".into()
        } else {
            "/bin/sh".into()
        };
        Self { shell }
    }
}

impl IPlatformExecutor for LinuxExecutor {
    fn get_default_shell(&self) -> &str {
        &self.shell
    }

    fn is_available(&self) -> bool {
        cfg!(unix)
    }

    fn execute(
        &self,
        command: &str,
    ) -> Pin<Box<dyn Future<Output = String> + Send + '_>> {
        let shell = self.shell.clone();
        let command = command.to_string();
        Box::pin(async move {
            let output = Command::new(&shell)
                .args(["-c", &command])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .output()
                .await;

            match output {
                Ok(out) => {
                    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    if stdout.is_empty() { stderr } else { stdout }
                }
                Err(e) => format!("Failed to start process: {}", e),
            }
        })
    }

    fn start_interactive_shell(&self) -> InteractiveShellHandle {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("failed to open PTY");

        let cmd = CommandBuilder::new(&self.shell);
        let child = pair
            .slave
            .spawn_command(cmd)
            .expect("failed to spawn shell on PTY");
        drop(pair.slave);

        let writer = pair.master.take_writer().expect("no pty writer");
        let reader = pair.master.try_clone_reader().expect("no pty reader");

        let (cancel_tx, _) = watch::channel(false);
        InteractiveShellHandle {
            child,
            master: pair.master,
            reader,
            writer,
            cancel_tx,
        }
    }

    fn get_drives(&self) -> Vec<String> {
        let mut drives = vec!["/".to_string()];
        if let Ok(entries) = std::fs::read_dir("/mnt") {
            for entry in entries.filter_map(|e| e.ok()) {
                drives.push(entry.path().to_string_lossy().to_string());
            }
        }
        if let Ok(entries) = std::fs::read_dir("/media") {
            for entry in entries.filter_map(|e| e.ok()) {
                drives.push(entry.path().to_string_lossy().to_string());
            }
        }
        drives
    }
}
