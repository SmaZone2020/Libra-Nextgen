pub mod encoding;
pub mod hardware;
#[cfg(not(target_os = "windows"))]
pub mod linux;
pub mod platform;
#[cfg(target_os = "windows")]
pub mod windows;

pub use encoding::decode_shell_bytes;
pub use platform::{get_executor, IPlatformExecutor, InteractiveShellHandle};
