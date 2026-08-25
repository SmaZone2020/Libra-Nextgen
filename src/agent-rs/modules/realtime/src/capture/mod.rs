//! 屏幕/摄像头/麦克风采集（从 libra-modules::execution 搬迁）。

mod camera_capture;
pub mod diff_codec;
mod mic_capture;
mod screen_capture;

pub use camera_capture::{CameraCapture, CameraFrame, CameraStream};
pub use mic_capture::MicCapture;
pub use screen_capture::{ScreenCapture, ScreenFrame, ScreenStream};
