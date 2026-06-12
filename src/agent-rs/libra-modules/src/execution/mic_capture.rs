/// Microphone capture — Windows-only, waveIn API-based.
/// Stub: full implementation requires Win32 waveIn FFI.
pub struct MicCapture;

impl MicCapture {
    pub fn list_devices() -> String {
        r#"[]"#.to_string()
    }

    pub fn start_capture(_device_index: u32) -> String {
        r#"{"error":"Microphone capture not yet implemented in Rust agent"}"#.to_string()
    }

    pub fn stop_capture() -> String {
        r#"{"status":"stopped"}"#.to_string()
    }
}
