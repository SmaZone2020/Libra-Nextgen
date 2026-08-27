pub mod encoding;
pub mod hardware;
#[cfg(not(target_os = "windows"))]
pub mod linux;
pub mod platform;
pub mod process;
#[cfg(unix)]
mod process_unix;
#[cfg(windows)]
mod process_windows;
#[cfg(target_os = "windows")]
pub mod windows;

pub use encoding::decode_shell_bytes;
pub use platform::{get_executor, IPlatformExecutor, InteractiveShellHandle};
pub use process::{ExitStatus, ProcessError, ProcessExecutor, ProcessOutput, SpawnedProcess};
