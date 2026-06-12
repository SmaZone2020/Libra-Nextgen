use base64::Engine;

/// Screen capture — Windows GDI-based with JPEG encoding.
/// Uses raw Win32 FFI (no external crate needed for GDI calls).
pub struct ScreenCapture;

impl ScreenCapture {
    pub fn list_screens() -> String {
        #[cfg(windows)]
        {
            let screen_w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
            let screen_h = unsafe { GetSystemMetrics(SM_CYSCREEN) };
            if screen_w > 0 && screen_h > 0 {
                return format!(r#"{{"screens":[{{"index":0,"width":{},"height":{}}}]}}"#, screen_w, screen_h);
            }
        }
        r#"{"screens":[],"error":"Not supported on this platform"}"#.to_string()
    }

    /// Capture a screenshot of the primary monitor and return as base64-encoded JPEG.
    /// `quality` can be "high" | "medium" | "low" (defaults to "medium").
    pub fn capture(quality: &str) -> String {
        #[cfg(windows)]
        {
            match capture_screen_windows(quality) {
                Ok(jpeg_base64) => {
                    format!(r#"{{"jpeg":"{}"}}"#, jpeg_base64)
                }
                Err(e) => format!(r#"{{"error":"{}"}}"#, e.replace('"', "'")),
            }
        }
        #[cfg(not(windows))]
        {
            r#"{"error":"Screen capture only supported on Windows"}"#.to_string()
        }
    }
}

#[cfg(windows)]
fn capture_screen_windows(quality: &str) -> Result<String, String> {
    let jpeg_quality = match quality {
        "high" => 90u8,
        "low" => 40u8,
        _ => 70u8,
    };

    unsafe {
        // Get desktop DC
        let hdc_screen = GetDC(std::ptr::null_mut());
        if hdc_screen.is_null() {
            return Err("GetDC failed".into());
        }

        let screen_w = GetSystemMetrics(SM_CXSCREEN);
        let screen_h = GetSystemMetrics(SM_CYSCREEN);
        if screen_w <= 0 || screen_h <= 0 {
            DeleteDC(hdc_screen);
            return Err("Invalid screen dimensions".into());
        }

        // Create compatible DC and bitmap
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() {
            DeleteDC(hdc_screen);
            return Err("CreateCompatibleDC failed".into());
        }

        let hbitmap = CreateCompatibleBitmap(hdc_screen, screen_w, screen_h);
        if hbitmap.is_null() {
            DeleteDC(hdc_mem);
            DeleteDC(hdc_screen);
            return Err("CreateCompatibleBitmap failed".into());
        }

        let old_bmp = SelectObject(hdc_mem, hbitmap as _);

        // Copy screen to bitmap
        if BitBlt(hdc_mem, 0, 0, screen_w, screen_h, hdc_screen, 0, 0, SRCCOPY) == 0 {
            SelectObject(hdc_mem, old_bmp);
            DeleteObject(hbitmap as _);
            DeleteDC(hdc_mem);
            DeleteDC(hdc_screen);
            return Err("BitBlt failed".into());
        }

        // Get bitmap bits
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: screen_w,
                biHeight: -screen_h, // negative = top-down DIB
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0, // BI_RGB
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD { rgbBlue: 0, rgbGreen: 0, rgbRed: 0, rgbReserved: 0 }; 1],
        };

        let row_size = ((screen_w * 32 + 31) / 32) * 4;
        let buf_size = (row_size * screen_h) as usize;
        let mut pixels: Vec<u8> = vec![0u8; buf_size];

        let ret = GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            screen_h as u32,
            pixels.as_mut_ptr() as _,
            &mut bi,
            0, // DIB_RGB_COLORS
        );

        // Cleanup GDI objects
        SelectObject(hdc_mem, old_bmp);
        DeleteObject(hbitmap as _);
        DeleteDC(hdc_mem);
        DeleteDC(hdc_screen);

        if ret == 0 {
            return Err("GetDIBits failed".into());
        }

        // pixels are BGRA (32bpp), convert to RGB and encode as JPEG
        let rgb: Vec<u8> = pixels
            .chunks_exact(4)
            .flat_map(|chunk| [chunk[2], chunk[1], chunk[0]]) // BGRA → RGB
            .collect();

        let mut jpeg_buf = Vec::new();
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, jpeg_quality);
        encoder
            .encode(&rgb, screen_w as u32, screen_h as u32, image::ExtendedColorType::Rgb8)
            .map_err(|e| format!("JPEG encode error: {}", e))?;

        Ok(base64::engine::general_purpose::STANDARD.encode(&jpeg_buf))
    }
}

// ── Win32 GDI FFI ────────────────────────────────────────────────────────

#[cfg(windows)]
const SM_CXSCREEN: i32 = 0;
#[cfg(windows)]
const SM_CYSCREEN: i32 = 1;
#[cfg(windows)]
const SRCCOPY: u32 = 0x00CC0020;

#[cfg(windows)]
#[repr(C)]
struct BITMAPINFOHEADER {
    biSize: u32,
    biWidth: i32,
    biHeight: i32,
    biPlanes: u16,
    biBitCount: u16,
    biCompression: u32,
    biSizeImage: u32,
    biXPelsPerMeter: i32,
    biYPelsPerMeter: i32,
    biClrUsed: u32,
    biClrImportant: u32,
}

#[cfg(windows)]
#[repr(C)]
struct RGBQUAD {
    rgbBlue: u8,
    rgbGreen: u8,
    rgbRed: u8,
    rgbReserved: u8,
}

#[cfg(windows)]
#[repr(C)]
struct BITMAPINFO {
    bmiHeader: BITMAPINFOHEADER,
    bmiColors: [RGBQUAD; 1],
}

#[cfg(windows)]
extern "system" {
    fn GetSystemMetrics(nIndex: i32) -> i32;
    fn GetDC(hWnd: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    fn CreateCompatibleDC(hdc: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    fn CreateCompatibleBitmap(hdc: *mut std::ffi::c_void, cx: i32, cy: i32) -> *mut std::ffi::c_void;
    fn SelectObject(hdc: *mut std::ffi::c_void, h: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    fn BitBlt(
        hdc: *mut std::ffi::c_void,
        x: i32, y: i32, cx: i32, cy: i32,
        hdcSrc: *mut std::ffi::c_void,
        x1: i32, y1: i32,
        rop: u32,
    ) -> i32;
    fn GetDIBits(
        hdc: *mut std::ffi::c_void,
        hbm: *mut std::ffi::c_void,
        start: u32,
        lines: u32,
        bits: *mut std::ffi::c_void,
        lpbmi: *mut BITMAPINFO,
        usage: u32,
    ) -> i32;
    fn DeleteDC(hdc: *mut std::ffi::c_void) -> i32;
    fn DeleteObject(ho: *mut std::ffi::c_void) -> i32;
}
