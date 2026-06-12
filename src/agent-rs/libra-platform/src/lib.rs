pub mod platform;
pub mod windows;
pub mod linux;
pub mod hardware;

pub use platform::{IPlatformExecutor, InteractiveShellHandle, get_executor};
