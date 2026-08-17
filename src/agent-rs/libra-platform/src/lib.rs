pub mod platform;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(not(target_os = "windows"))]
pub mod linux;
pub mod hardware;
pub mod encoding;

pub use platform::{IPlatformExecutor, InteractiveShellHandle, get_executor};
pub use encoding::decode_shell_bytes;
