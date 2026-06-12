/// Screen capture — Windows-only, GDI-based.
/// Stub: full implementation requires GDI FFI (BitBlt, etc.) and JPEG encoding.
/// TODO: Implement with windows-sys crate or raw FFI.
pub struct ScreenCapture;

impl ScreenCapture {
    pub fn list_screens() -> String {
        #[cfg(target_os = "windows")]
        {
            let screen_w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
            let screen_h = unsafe { GetSystemMetrics(SM_CYSCREEN) };
            format!(r#"{{"screens":[{{"index":0,"width":{},"height":{}}}]}}"#, screen_w, screen_h)
        }
        #[cfg(not(target_os = "windows"))]
        {
            r#"{"screens":[],"error":"Not supported on this platform"}"#.to_string()
        }
    }

    /// Capture a screenshot and return as base64-encoded JPEG.
    /// Currently returns an error — full implementation requires Win32 GDI FFI.
    pub fn capture(_quality: &str) -> String {
        r#"{"error":"Screen capture not yet implemented in Rust agent"}"#.to_string()
    }
}

#[cfg(target_os = "windows")]
const SM_CXSCREEN: i32 = 0;
#[cfg(target_os = "windows")]
const SM_CYSCREEN: i32 = 1;

#[cfg(target_os = "windows")]
extern "system" {
    fn GetSystemMetrics(nIndex: i32) -> i32;
}
