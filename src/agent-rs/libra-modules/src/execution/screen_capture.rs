use base64::Engine;
use std::sync::Mutex;

const BLOCK_SIZE: i32 = 64;
const DIFF_THRESHOLD_PERCENT: i32 = 70; // fall back to keyframe if >70% blocks changed
const JPEG_QUALITY: u8 = 70;

/// Screen capture — Windows GDI-based with JPEG encoding.
/// Uses raw Win32 FFI (no external crate needed for GDI calls).
/// Supports multi-monitor enumeration and per-monitor capture.
pub struct ScreenCapture;

/// Cached monitor rectangles from EnumDisplayMonitors.
static MONITOR_RECTS: Mutex<Vec<MonitorRect>> = Mutex::new(Vec::new());

#[derive(Clone, Debug)]
struct MonitorRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// Block coordinates for diff encoding.
struct BlockInfo {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// Result of a streaming capture — either a full keyframe or diff blocks.
pub enum ScreenFrame {
    Keyframe { width: i32, height: i32, jpeg: String },
    Diff { blocks_json: String },
}

/// Stateful screen stream that tracks the previous frame for diff computation.
pub struct ScreenStream {
    prev_rgb: Option<Vec<u8>>,
    prev_width: i32,
    prev_height: i32,
}

impl ScreenStream {
    pub fn new() -> Self {
        Self { prev_rgb: None, prev_width: 0, prev_height: 0 }
    }

    /// Capture a frame and return either a keyframe or diff blocks.
    /// `quality` is unused for now (C# compatibility — always uses JPEG quality 70).
    /// `screen_index` selects the monitor (0 = primary).
    pub fn capture(&mut self, _quality: &str, screen_index: u32) -> ScreenFrame {
        #[cfg(windows)]
        {
            match capture_raw(screen_index) {
                Ok((rgb, w, h)) => {
                    let frame = self.process_frame(&rgb, w, h);
                    // Update previous frame
                    self.prev_rgb = Some(rgb);
                    self.prev_width = w;
                    self.prev_height = h;
                    frame
                }
                Err(e) => {
                    // On error, invalidate previous frame so next success is a keyframe
                    self.prev_rgb = None;
                    ScreenFrame::Keyframe { width: 0, height: 0, jpeg: String::new() }
                }
            }
        }
        #[cfg(not(windows))]
        {
            ScreenFrame::Keyframe { width: 0, height: 0, jpeg: String::new() }
        }
    }

    fn process_frame(&self, rgb: &[u8], w: i32, h: i32) -> ScreenFrame {
        // First frame or resolution change → keyframe
        let need_keyframe = match &self.prev_rgb {
            None => true,
            Some(_) => w != self.prev_width || h != self.prev_height,
        };

        if need_keyframe {
            return ScreenFrame::Keyframe {
                width: w,
                height: h,
                jpeg: rgb_to_jpeg_base64(rgb, w, h),
            };
        }

        // Compute diff blocks vs previous frame
        let prev = self.prev_rgb.as_ref().unwrap();
        let blocks = compute_changed_blocks(rgb, prev, w, h);

        let blocks_x = (w + BLOCK_SIZE - 1) / BLOCK_SIZE;
        let blocks_y = (h + BLOCK_SIZE - 1) / BLOCK_SIZE;
        let total_blocks = blocks_x * blocks_y;

        // If >70% blocks changed, fall back to keyframe
        if blocks.len() as i32 > total_blocks * DIFF_THRESHOLD_PERCENT / 100 {
            return ScreenFrame::Keyframe {
                width: w,
                height: h,
                jpeg: rgb_to_jpeg_base64(rgb, w, h),
            };
        }

        // Encode changed blocks as individual JPEGs
        let encoded: Vec<String> = blocks.iter().map(|b| encode_diff_block(rgb, w, b)).collect();
        ScreenFrame::Diff { blocks_json: format!("[{}]", encoded.join(",")) }
    }
}

impl ScreenCapture {
    /// List available screens.
    /// Primary: PowerShell Get-WmiObject Win32_VideoController (as user requested).
    /// Fallback: EnumDisplayMonitors Win32 API.
    pub fn list_screens() -> String {
        #[cfg(windows)]
        {
            if let Some(json) = ps_list_screens() {
                return json;
            }
            let monitors = enum_display_monitors();
            if !monitors.is_empty() {
                let items: Vec<String> = monitors.iter().enumerate().map(|(i, m)| {
                    format!(r#"{{"index":{},"width":{},"height":{},"caption":"Monitor {}"}}"#,
                        i, m.right - m.left, m.bottom - m.top, i + 1)
                }).collect();
                return format!(r#"{{"screens":[{}]}}"#, items.join(","));
            }
        }
        r#"{"screens":[],"error":"Not supported on this platform"}"#.to_string()
    }

    /// Capture a single screenshot and return as base64 JPEG JSON.
    /// For one-shot screenshots (not streaming). Use ScreenStream for continuous capture.
    pub fn capture(quality: &str, screen_index: Option<u32>) -> String {
        #[cfg(windows)]
        {
            match capture_single(quality, screen_index.unwrap_or(0)) {
                Ok((jpeg_base64, width, height)) => {
                    format!(r#"{{"width":{},"height":{},"jpeg":"{}"}}"#, width, height, jpeg_base64)
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

// ── Raw pixel capture (shared by one-shot and streaming) ─────────────

#[cfg(windows)]
fn capture_raw(screen_index: u32) -> Result<(Vec<u8>, i32, i32), String> {
    let monitors = enum_display_monitors();
    if monitors.is_empty() {
        return Err("No monitors found".into());
    }

    let idx = screen_index as usize;
    if idx >= monitors.len() {
        return Err(format!("Screen index {} not found. Available: {}", screen_index, monitors.len()));
    }

    let m = &monitors[idx];
    let cap_x = m.left;
    let cap_y = m.top;
    let screen_w = m.right - m.left;
    let screen_h = m.bottom - m.top;

    if screen_w <= 0 || screen_h <= 0 {
        return Err("Invalid monitor dimensions".into());
    }

    unsafe {
        let hdc_screen = GetDC(std::ptr::null_mut());
        if hdc_screen.is_null() { return Err("GetDC failed".into()); }

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() { DeleteDC(hdc_screen); return Err("CreateCompatibleDC failed".into()); }

        let hbitmap = CreateCompatibleBitmap(hdc_screen, screen_w, screen_h);
        if hbitmap.is_null() { DeleteDC(hdc_mem); DeleteDC(hdc_screen); return Err("CreateCompatibleBitmap failed".into()); }

        let old_bmp = SelectObject(hdc_mem, hbitmap as _);

        if BitBlt(hdc_mem, 0, 0, screen_w, screen_h, hdc_screen, cap_x, cap_y, SRCCOPY) == 0 {
            SelectObject(hdc_mem, old_bmp);
            DeleteObject(hbitmap as _);
            DeleteDC(hdc_mem);
            DeleteDC(hdc_screen);
            return Err("BitBlt failed".into());
        }

        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: screen_w,
                biHeight: -screen_h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
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

        let ret = GetDIBits(hdc_mem, hbitmap, 0, screen_h as u32, pixels.as_mut_ptr() as _, &mut bi, 0);

        // Cleanup
        SelectObject(hdc_mem, old_bmp);
        DeleteObject(hbitmap as _);
        DeleteDC(hdc_mem);
        DeleteDC(hdc_screen);

        if ret == 0 { return Err("GetDIBits failed".into()); }

        // BGRA → RGB (dropping alpha channel)
        let rgb: Vec<u8> = pixels
            .chunks_exact(4)
            .flat_map(|chunk| [chunk[2], chunk[1], chunk[0]])
            .collect();

        Ok((rgb, screen_w, screen_h))
    }
}

#[cfg(windows)]
fn capture_single(_quality: &str, screen_index: u32) -> Result<(String, i32, i32), String> {
    let (rgb, w, h) = capture_raw(screen_index)?;
    Ok((rgb_to_jpeg_base64(&rgb, w, h), w, h))
}

/// Encode RGB pixels to JPEG and return base64 string.
fn rgb_to_jpeg_base64(rgb: &[u8], width: i32, height: i32) -> String {
    let mut jpeg_buf = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, JPEG_QUALITY);
    if encoder.encode(rgb, width as u32, height as u32, image::ExtendedColorType::Rgb8).is_ok() {
        base64::engine::general_purpose::STANDARD.encode(&jpeg_buf)
    } else {
        String::new()
    }
}

// ── Diff computation ─────────────────────────────────────────────────

fn compute_changed_blocks(current: &[u8], previous: &[u8], width: i32, height: i32) -> Vec<BlockInfo> {
    let blocks_x = (width + BLOCK_SIZE - 1) / BLOCK_SIZE;
    let blocks_y = (height + BLOCK_SIZE - 1) / BLOCK_SIZE;
    let mut blocks = Vec::new();

    for by in 0..blocks_y {
        for bx in 0..blocks_x {
            let x = bx * BLOCK_SIZE;
            let y = by * BLOCK_SIZE;
            let w = BLOCK_SIZE.min(width - x);
            let h = BLOCK_SIZE.min(height - y);

            if !block_equals(current, previous, x, y, w, h, width) {
                blocks.push(BlockInfo { x, y, w, h });
            }
        }
    }
    blocks
}

fn block_equals(current: &[u8], previous: &[u8], x: i32, y: i32, w: i32, h: i32, full_width: i32) -> bool {
    for row in y..y + h {
        let off = (row * full_width + x) as usize * 3;
        let len = w as usize * 3;
        if current.get(off..off + len) != previous.get(off..off + len) {
            return false;
        }
    }
    true
}

/// Encode a single changed block region as a JSON fragment: {"x":X,"y":Y,"w":W,"h":H,"data":"base64-jpeg"}
fn encode_diff_block(rgb: &[u8], full_width: i32, block: &BlockInfo) -> String {
    // Extract block pixels row by row
    let mut block_pixels = Vec::with_capacity((block.w * block.h * 3) as usize);
    for row in block.y..block.y + block.h {
        let off = (row * full_width + block.x) as usize * 3;
        let len = block.w as usize * 3;
        block_pixels.extend_from_slice(&rgb[off..off + len]);
    }

    let jpeg_base64 = rgb_to_jpeg_base64(&block_pixels, block.w, block.h);
    format!(
        r#"{{"x":{},"y":{},"w":{},"h":{},"data":"{}"}}"#,
        block.x, block.y, block.w, block.h, jpeg_base64
    )
}

// ── PowerShell screen listing ──────────────────────────────────────────

#[cfg(windows)]
fn ps_list_screens() -> Option<String> {
    use std::os::windows::process::CommandExt;

    let script = r#"
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Get-WmiObject Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution -ne $null } | ForEach-Object {
    [PSCustomObject]@{
        Caption = $_.Caption
        CurrentHorizontalResolution = $_.CurrentHorizontalResolution
        CurrentVerticalResolution = $_.CurrentVerticalResolution
    }
} | ConvertTo-Json -Compress
"#;
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    let json = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if json.is_empty() || !json.contains('[') {
        return None;
    }

    let start = json.find('[')?;
    let end = json.rfind(']')?;
    let inner = &json[start..=end];

    let mut screens = Vec::new();
    let mut idx: u32 = 0;
    let mut pos = 0;
    let chars: Vec<char> = inner.chars().collect();
    while pos < chars.len() {
        if chars[pos] == '{' {
            let mut caption = String::new();
            let mut width: i32 = 0;
            let mut height: i32 = 0;
            let mut in_key = String::new();
            let mut in_value = String::new();
            let mut parsing_key = true;
            let mut in_string = false;
            pos += 1;

            while pos < chars.len() && chars[pos] != '}' {
                let c = chars[pos];
                if c == '"' {
                    in_string = !in_string;
                } else if !in_string && c == ':' {
                    parsing_key = false;
                    pos += 1;
                    continue;
                } else if !in_string && c == ',' {
                    let key = in_key.trim_matches(|c| c == '"' || c == ' ');
                    let val = in_value.trim_matches(|c| c == '"' || c == ' ');
                    match key {
                        "Caption" => caption = val.to_string(),
                        "CurrentHorizontalResolution" => width = val.parse().unwrap_or(0),
                        "CurrentVerticalResolution" => height = val.parse().unwrap_or(0),
                        _ => {}
                    }
                    in_key.clear();
                    in_value.clear();
                    parsing_key = true;
                    pos += 1;
                    continue;
                }

                if parsing_key { in_key.push(c); } else { in_value.push(c); }
                pos += 1;
            }
            let key = in_key.trim_matches(|c| c == '"' || c == ' ');
            let val = in_value.trim_matches(|c| c == '"' || c == ' ');
            match key {
                "Caption" => caption = val.to_string(),
                "CurrentHorizontalResolution" => width = val.parse().unwrap_or(0),
                "CurrentVerticalResolution" => height = val.parse().unwrap_or(0),
                _ => {}
            }

            if width > 0 && height > 0 {
                screens.push(format!(
                    r#"{{"index":{},"width":{},"height":{},"caption":"{}"}}"#,
                    idx, width, height, caption.replace('"', "'")
                ));
                idx += 1;
            }
        }
        pos += 1;
    }

    Some(format!(r#"{{"screens":[{}]}}"#, screens.join(",")))
}

#[cfg(windows)]
fn enum_display_monitors() -> Vec<MonitorRect> {
    let mut rects: Vec<MonitorRect> = Vec::new();
    let data_ptr = &mut rects as *mut Vec<MonitorRect> as isize;

    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            Some(monitor_enum_proc),
            data_ptr,
        );
    }

    rects
}

#[cfg(windows)]
unsafe extern "system" fn monitor_enum_proc(
    h_monitor: *mut std::ffi::c_void,
    _hdc: *mut std::ffi::c_void,
    _rect: *mut RECT,
    data: isize,
) -> i32 {
    if data == 0 { return 0; }
    let rects = &mut *(data as *mut Vec<MonitorRect>);

    let mut mi: MONITORINFOEXW = std::mem::zeroed();
    mi.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(h_monitor, &mut mi as *mut MONITORINFOEXW as *mut MONITORINFO) != 0 {
        rects.push(MonitorRect {
            left: mi.monitorInfo.rcMonitor.left,
            top: mi.monitorInfo.rcMonitor.top,
            right: mi.monitorInfo.rcMonitor.right,
            bottom: mi.monitorInfo.rcMonitor.bottom,
        });
    }
    1
}

// ── Win32 GDI + Monitor FFI ────────────────────────────────────────────

#[cfg(windows)]
const SRCCOPY: u32 = 0x00CC0020;

#[cfg(windows)]
#[repr(C)]
struct RECT {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(windows)]
#[repr(C)]
struct MONITORINFO {
    cbSize: u32,
    rcMonitor: RECT,
    rcWork: RECT,
    dwFlags: u32,
}

#[cfg(windows)]
#[repr(C)]
struct MONITORINFOEXW {
    monitorInfo: MONITORINFO,
    szDevice: [u16; 32],
}

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
    fn EnumDisplayMonitors(
        hdc: *mut std::ffi::c_void,
        lprcClip: *mut RECT,
        lpfnEnum: Option<unsafe extern "system" fn(
            *mut std::ffi::c_void,
            *mut std::ffi::c_void,
            *mut RECT,
            isize,
        ) -> i32>,
        dwData: isize,
    ) -> i32;
    fn GetMonitorInfoW(
        hMonitor: *mut std::ffi::c_void,
        lpmi: *mut MONITORINFO,
    ) -> i32;
}
