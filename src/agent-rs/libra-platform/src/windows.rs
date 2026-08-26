use crate::platform::{IPlatformExecutor, InteractiveShellHandle};
use std::future::Future;
use std::pin::Pin;
use tokio::process::Command;
use tokio::sync::watch;

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

    fn execute(&self, command: &str) -> Pin<Box<dyn Future<Output = String> + Send + '_>> {
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
                    if stdout.is_empty() {
                        stderr
                    } else {
                        stdout
                    }
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
            .expect("failed to open ConPTY");

        let cmd = CommandBuilder::new("cmd.exe");
        let child = pair
            .slave
            .spawn_command(cmd)
            .expect("failed to spawn cmd.exe on ConPTY");
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
