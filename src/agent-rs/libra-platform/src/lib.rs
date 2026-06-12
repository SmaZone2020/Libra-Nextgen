pub mod platform;
pub mod windows;
pub mod linux;
pub mod hardware;
pub mod encoding;

pub use platform::{IPlatformExecutor, InteractiveShellHandle, get_executor};
pub use encoding::decode_shell_bytes;
