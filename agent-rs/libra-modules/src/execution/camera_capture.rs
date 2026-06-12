/// Camera capture — Windows-only, DirectShow/MediaFoundation-based.
/// Stub: full implementation requires COM FFI (IMFMediaSource, etc.).
pub struct CameraCapture;

impl CameraCapture {
    pub fn list_cameras() -> String {
        r#"{"cameras":[],"note":"Camera enumeration not yet implemented in Rust agent"}"#.to_string()
    }

    pub fn capture(_camera_index: u32) -> String {
        r#"{"error":"Camera capture not yet implemented in Rust agent"}"#.to_string()
    }
}
