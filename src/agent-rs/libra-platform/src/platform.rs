use portable_pty::{Child, MasterPty};
use std::io::{Read, Write};
use tokio::sync::watch;

/// Platform-agnostic executor interface.
/// Port of IPlatformExecutor.cs.
pub trait IPlatformExecutor: Send + Sync {
    /// Execute a command and return output as string.
    fn execute(
        &self,
        command: &str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = String> + Send + '_>>;

    /// Return the default shell path.
    fn get_default_shell(&self) -> &str;

    /// Whether this executor is available on the current platform.
    fn is_available(&self) -> bool;

    /// Start an interactive shell process attached to a pseudo-terminal
    /// (ConPTY on Windows, openpty on Unix) so full terminal semantics
    /// (line editing, full-screen apps, cursor addressing) work.
    fn start_interactive_shell(&self) -> InteractiveShellHandle;

    /// List logical drives (C:\, D:\ on Windows; /, /mnt/* on Linux).
    fn get_drives(&self) -> Vec<String>;
}

/// Handle to a running interactive PTY shell.
pub struct InteractiveShellHandle {
    pub child: Box<dyn Child + Send + Sync>,
    pub master: Box<dyn MasterPty + Send>,
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
    pub cancel_tx: watch::Sender<bool>,
}

impl InteractiveShellHandle {
    pub fn cancel(&self) {
        let _ = self.cancel_tx.send(true);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.cancel_tx.borrow()
    }
}

/// Create the appropriate executor for the current platform.
pub fn get_executor() -> Box<dyn IPlatformExecutor> {
    #[cfg(target_os = "windows")]
    {
        Box::new(super::windows::WindowsExecutor::new())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Box::new(super::linux::LinuxExecutor::new())
    }
}
