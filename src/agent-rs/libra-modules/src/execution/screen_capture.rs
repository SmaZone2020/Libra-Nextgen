//! Screen capture — DXGI Desktop Duplication API with GDI fallback.
//! Port of Modules/Execution/ScreenCapture.cs
//!
//! Uses DXGI for low-latency GPU-accelerated capture (Win8+).
//! Falls back to GDI BitBlt when DXGI is unavailable.
//! First frame sends a full keyframe; subsequent frames use DirtyRects
//! from DXGI to send only changed 64×64 blocks as JPEG diffs.

use base64::Engine;
use std::sync::Mutex;

const BLOCK_SIZE: i32 = 64;
const DIFF_THRESHOLD_PERCENT: i32 = 70;
const JPEG_QUALITY: u8 = 50;

/// Map quality string to max dimension. Returns (max_width, max_height), or (0, 0) for original.
fn quality_max_dim(quality: &str) -> (i32, i32) {
    match quality {
        "1080p" => (1920, 1080),
        "720p" => (1280, 720),
        "540p" => (960, 540),
        "360p" => (640, 360),
        "240p" => (426, 240),
        _ => (0, 0), // original — no cap
    }
}

/// Resize RGB pixels to a new resolution using the `image` crate (Lanczos3).
fn resize_rgb(rgb: &[u8], src_w: i32, src_h: i32, dst_w: i32, dst_h: i32) -> Vec<u8> {
    let img = image::RgbImage::from_raw(src_w as u32, src_h as u32, rgb.to_vec())
        .unwrap_or_else(|| image::RgbImage::new(src_w as u32, src_h as u32));
    let resized = image::imageops::resize(
        &img,
        dst_w as u32,
        dst_h as u32,
        image::imageops::FilterType::Lanczos3,
    );
    resized.into_raw()
}

/// Screen capture — Windows GDI-based with JPEG encoding.
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
#[derive(Clone)]
struct BlockInfo {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// Result of a streaming capture — either a full keyframe, diff blocks, or no change.
pub enum ScreenFrame {
    Keyframe { width: i32, height: i32, jpeg: String },
    Diff { blocks_json: String },
    /// No visual change since last frame — engine should skip sending.
    Empty,
}

// ── DXGI Desktop Duplication (Windows 8+) ──────────────────────────

#[cfg(windows)]
mod dxgi_impl {
    use windows::core::Interface;
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Direct3D::*;
    use windows::Win32::Graphics::Dxgi::*;
    use windows::Win32::Graphics::Dxgi::Common::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::Foundation::*;

    pub struct DxgiDuplicator {
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        duplication: IDXGIOutputDuplication,
        staging: Option<ID3D11Texture2D>,
        width: u32,
        height: u32,
        output_idx: u32,
    }

    impl DxgiDuplicator {
        /// Create a DXGI duplicator for the given monitor index.
        pub fn new(screen_index: u32) -> Result<Self, String> {
            unsafe {
                // COM must be initialized for this thread
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

                let mut device: Option<ID3D11Device> = None;
                let mut context: Option<ID3D11DeviceContext> = None;
                let null_adapter: Option<&IDXGIAdapter> = None;

                let res = D3D11CreateDevice(
                    null_adapter,
                    D3D_DRIVER_TYPE_HARDWARE,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    None,
                    D3D11_SDK_VERSION,
                    Some(&mut device as *mut Option<ID3D11Device>),
                    None,
                    Some(&mut context as *mut Option<ID3D11DeviceContext>),
                );

                if res.is_err() {
                    // Try WARP (software) as fallback
                    let res2 = D3D11CreateDevice(
                        null_adapter,
                        D3D_DRIVER_TYPE_WARP,
                        HMODULE::default(),
                        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                        None,
                        D3D11_SDK_VERSION,
                        Some(&mut device as *mut Option<ID3D11Device>),
                        None,
                        Some(&mut context as *mut Option<ID3D11DeviceContext>),
                    );
                    if res2.is_err() {
                        return Err(format!(
                            "D3D11CreateDevice failed: {:?} / {:?}",
                            res.unwrap_err(),
                            res2.unwrap_err()
                        ));
                    }
                }

                let device = device.ok_or("No D3D11 device")?;
                let context = context.ok_or("No D3D11 context")?;

                let (duplication, width, height, output_idx) =
                    setup_duplicator(&device, screen_index)?;

                let staging = create_staging_texture(&device, width, height)?;

                Ok(Self {
                    device,
                    context,
                    duplication,
                    staging: Some(staging),
                    width,
                    height,
                    output_idx,
                })
            }
        }

        /// Recreate the duplicator after access loss (resolution change, UAC, etc.)
        fn reinit(&mut self) -> Result<(), String> {
            unsafe {
                let (dup, w, h, _idx) = setup_duplicator(&self.device, self.output_idx)?;
                self.duplication = dup;
                if w != self.width || h != self.height {
                    self.staging = Some(create_staging_texture(&self.device, w, h)?);
                    self.width = w;
                    self.height = h;
                }
            }
            Ok(())
        }

        /// Capture one frame. Returns (rgb_pixels, width, height).
        /// Returns `Err("timeout")` if no new frame available.
        pub fn capture(&mut self) -> Result<(Vec<u8>, i32, i32), String> {
            unsafe {
                let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
                let mut desktop_resource: Option<IDXGIResource> = None;

                loop {
                    let res = self.duplication.AcquireNextFrame(
                        100,
                        &mut frame_info,
                        &mut desktop_resource as *mut Option<IDXGIResource>,
                    );

                    match res {
                        Ok(()) => break,
                        Err(e) => {
                            if e.code() == DXGI_ERROR_WAIT_TIMEOUT {
                                return Err("timeout".into());
                            }
                            if e.code() == DXGI_ERROR_ACCESS_LOST {
                                self.reinit()?;
                                continue;
                            }
                            return Err(format!("AcquireNextFrame failed: {e:?}"));
                        }
                    }
                }

                let resource = match desktop_resource {
                    Some(r) => r,
                    None => return Err("No desktop resource".into()),
                };

                // Get the desktop texture
                let desktop_tex: ID3D11Texture2D = match resource.cast() {
                    Ok(t) => t,
                    Err(e) => {
                        let _ = self.duplication.ReleaseFrame();
                        return Err(format!("QueryInterface ID3D11Texture2D failed: {e:?}"));
                    }
                };

                // Copy to staging texture
                let staging = self.staging.as_ref().ok_or("No staging texture")?;
                self.context.CopyResource(staging, &desktop_tex);

                // Release frame before mapping (allows GPU to start next frame)
                let _ = self.duplication.ReleaseFrame();
                drop(desktop_tex);
                drop(resource);

                // Map staging texture
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                self.context
                    .Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped as *mut _))
                    .map_err(|e| format!("Map failed: {e:?}"))?;

                let stride = mapped.RowPitch as usize;
                let src = std::slice::from_raw_parts(
                    mapped.pData as *const u8,
                    stride * self.height as usize,
                );

                // BGRA → RGB with stride
                let rgb = bgra_to_rgb_strided(src, self.width as i32, self.height as i32, stride);

                self.context.Unmap(staging, 0);

                Ok((rgb, self.width as i32, self.height as i32))
            }
        }
    }

    /// Set up IDXGIOutputDuplication for the given screen index.
    unsafe fn setup_duplicator(
        device: &ID3D11Device,
        screen_index: u32,
    ) -> Result<(IDXGIOutputDuplication, u32, u32, u32), String> {
        let dxgi_device: IDXGIDevice =
            device.cast().map_err(|e| format!("cast IDXGIDevice: {e:?}"))?;
        let adapter: IDXGIAdapter =
            dxgi_device.GetAdapter().map_err(|e| format!("GetAdapter: {e:?}"))?;

        // Try the requested output index; fall back to 0
        let output = match adapter.EnumOutputs(screen_index) {
            Ok(o) => o,
            Err(_) => adapter.EnumOutputs(0).map_err(|e| format!("EnumOutputs(0): {e:?}"))?,
        };
        let actual_idx = if adapter.EnumOutputs(screen_index).is_ok() {
            screen_index
        } else {
            0
        };

        let output1: IDXGIOutput1 =
            output.cast().map_err(|e| format!("cast IDXGIOutput1: {e:?}"))?;
        let desc = output1.GetDesc().map_err(|e| format!("GetDesc: {e:?}"))?;
        let width = (desc.DesktopCoordinates.right - desc.DesktopCoordinates.left) as u32;
        let height = (desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top) as u32;

        let duplication = output1
            .DuplicateOutput(device)
            .map_err(|e| format!("DuplicateOutput: {e:?}"))?;

        Ok((duplication, width, height, actual_idx))
    }

    /// Create a CPU-readable staging texture.
    unsafe fn create_staging_texture(
        device: &ID3D11Device,
        width: u32,
        height: u32,
    ) -> Result<ID3D11Texture2D, String> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };

        let mut tex: Option<ID3D11Texture2D> = None;
        device
            .CreateTexture2D(&desc, None, Some(&mut tex as *mut _))
            .map_err(|e| format!("CreateTexture2D staging: {e:?}"))?;

        tex.ok_or("CreateTexture2D returned null".into())
    }

    /// Convert BGRA pixels with row stride to tightly packed RGB.
    fn bgra_to_rgb_strided(src: &[u8], width: i32, height: i32, stride: usize) -> Vec<u8> {
        let w = width as usize;
        let h = height as usize;
        let mut rgb = Vec::with_capacity(w * h * 3);
        for row in 0..h {
            let row_start = row * stride;
            for col in 0..w {
                let p = row_start + col * 4;
                rgb.push(src[p + 2]); // R
                rgb.push(src[p + 1]); // G
                rgb.push(src[p]);     // B
            }
        }
        rgb
    }

}

// ── ScreenStream ────────────────────────────────────────────────────

/// Stateful screen stream that tracks the previous frame for diff computation.
/// Uses DXGI Desktop Duplication when available, falls back to GDI.
pub struct ScreenStream {
    #[cfg(windows)]
    dxgi: Option<dxgi_impl::DxgiDuplicator>,
    #[cfg(windows)]
    dxgi_failed: bool,

    prev_rgb: Option<Vec<u8>>,
    prev_width: i32,
    prev_height: i32,
    current_screen: i32,
}

impl ScreenStream {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            dxgi: None,
            #[cfg(windows)]
            dxgi_failed: false,
            prev_rgb: None,
            prev_width: 0,
            prev_height: 0,
            current_screen: -1,
        }
    }

    /// Capture a frame and return either a keyframe, diff blocks, or Empty (no change).
    /// `quality` controls resolution cap: "original", "1080p", "720p", etc.
    /// `screen_index` selects the monitor (0 = primary).
    pub fn capture(&mut self, quality: &str, screen_index: u32) -> ScreenFrame {
        #[cfg(windows)]
        {
            let si = screen_index as i32;

            // On screen change, reset DXGI state
            if si != self.current_screen {
                self.dxgi = None;
                self.dxgi_failed = false;
                self.prev_rgb = None;
                self.current_screen = si;
            }

            // Try DXGI if not previously failed
            if !self.dxgi_failed {
                let frame = self.capture_dxgi(screen_index, quality);
                match frame {
                    ScreenFrame::Empty => return ScreenFrame::Empty,
                    f @ ScreenFrame::Keyframe { .. } | f @ ScreenFrame::Diff { .. } => return f,
                }
            }

            // Fallback to GDI
            self.capture_gdi(screen_index, quality)
        }
        #[cfg(not(windows))]
        {
            ScreenFrame::Keyframe { width: 0, height: 0, jpeg: String::new() }
        }
    }

    #[cfg(windows)]
    fn capture_dxgi(&mut self, screen_index: u32, quality: &str) -> ScreenFrame {
        let dxgi = match &mut self.dxgi {
            Some(d) => d,
            None => {
                match dxgi_impl::DxgiDuplicator::new(screen_index) {
                    Ok(d) => {
                        self.current_screen = screen_index as i32;
                        self.dxgi.insert(d)
                    }
                    Err(e) => {
                        eprintln!("[screen] DXGI init failed, falling back to GDI: {e}");
                        self.dxgi_failed = true;
                        return ScreenFrame::Keyframe {
                            width: 0,
                            height: 0,
                            jpeg: String::new(),
                        };
                    }
                }
            }
        };

        match dxgi.capture() {
            Ok((rgb, w, h)) => {
                // Use CPU diff (same algorithm as GDI fallback) for reliable detection
                let frame = self.process_frame_cpu(&rgb, w, h, quality);
                self.prev_rgb = Some(rgb);
                self.prev_width = w;
                self.prev_height = h;
                frame
            }
            Err(e) => {
                if e == "timeout" {
                    // Screen static — send empty diff to keep SSE stream alive
                    return ScreenFrame::Diff { blocks_json: "[]".to_string() };
                }
                eprintln!("[screen] DXGI capture error, falling back to GDI: {e}");
                self.dxgi = None;
                self.dxgi_failed = true;
                ScreenFrame::Keyframe { width: 0, height: 0, jpeg: String::new() }
            }
        }
    }

    #[cfg(windows)]
    fn capture_gdi(&mut self, screen_index: u32, quality: &str) -> ScreenFrame {
        match capture_raw(screen_index) {
            Ok((rgb, w, h)) => {
                let frame = self.process_frame_cpu(&rgb, w, h, quality);
                self.prev_rgb = Some(rgb);
                self.prev_width = w;
                self.prev_height = h;
                frame
            }
            Err(_) => {
                self.prev_rgb = None;
                ScreenFrame::Keyframe { width: 0, height: 0, jpeg: String::new() }
            }
        }
    }

    /// CPU diff path — resize to quality cap, diff, merge adjacent blocks, encode.
    fn process_frame_cpu(&self, rgb: &[u8], w: i32, h: i32, quality: &str) -> ScreenFrame {
        // Resize if quality limits resolution
        let (max_w, max_h) = quality_max_dim(quality);
        let (working_w, working_h) = if max_w > 0 && max_h > 0 && (w > max_w || h > max_h) {
            let scale = (max_w as f64 / w as f64).min(max_h as f64 / h as f64);
            ((w as f64 * scale) as i32, (h as f64 * scale) as i32)
        } else {
            (w, h)
        };
        let working_rgb: Vec<u8> = if working_w != w || working_h != h {
            resize_rgb(rgb, w, h, working_w, working_h)
        } else {
            rgb.to_vec()
        };

        let need_keyframe = match &self.prev_rgb {
            None => true,
            Some(_) => working_w != self.prev_width || working_h != self.prev_height,
        };

        if need_keyframe {
            return ScreenFrame::Keyframe {
                width: working_w,
                height: working_h,
                jpeg: rgb_to_jpeg_base64(&working_rgb, working_w, working_h),
            };
        }

        let prev = self.prev_rgb.as_ref().unwrap();
        let blocks = compute_changed_blocks(&working_rgb, prev, working_w, working_h);

        let blocks_x = (working_w + BLOCK_SIZE - 1) / BLOCK_SIZE;
        let blocks_y = (working_h + BLOCK_SIZE - 1) / BLOCK_SIZE;
        let total_blocks = blocks_x * blocks_y;

        if blocks.len() as i32 > total_blocks * DIFF_THRESHOLD_PERCENT / 100 {
            return ScreenFrame::Keyframe {
                width: working_w,
                height: working_h,
                jpeg: rgb_to_jpeg_base64(&working_rgb, working_w, working_h),
            };
        }

        let merged = merge_adjacent_blocks(&blocks);

        let encoded: Vec<String> = merged
            .iter()
            .map(|b| encode_diff_block(&working_rgb, working_w, b))
            .collect();
        ScreenFrame::Diff { blocks_json: format!("[{}]", encoded.join(",")) }
    }

    /// Invalidate the diff state so the next frame is forced as a keyframe.
    /// Useful after screen change or error recovery.
    pub fn invalidate(&mut self) {
        self.prev_rgb = None;
    }
}

// ── ScreenCapture (one-shot screenshots) ────────────────────────────

impl ScreenCapture {
    /// List available screens via PowerShell (primary) or EnumDisplayMonitors (fallback).
    pub fn list_screens() -> String {
        #[cfg(windows)]
        {
            if let Some(json) = ps_list_screens() {
                return json;
            }
            let monitors = enum_display_monitors();
            if !monitors.is_empty() {
                let mut idx: u32 = 0;
                let items: Vec<String> = monitors
                    .iter()
                    .filter(|m| m.right > m.left && m.bottom > m.top)
                    .map(|m| {
                        let w = m.right - m.left;
                        let h = m.bottom - m.top;
                        let i = idx;
                        idx += 1;
                        format!(
                            r#"{{"index":{},"width":{},"height":{},"caption":"Monitor {}({}x{})"}}"#,
                            i, w, h, i + 1, w, h
                        )
                    })
                    .collect();
                return format!(r#"{{"screens":[{}]}}"#, items.join(","));
            }
        }
        r#"{"screens":[],"error":"Not supported on this platform"}"#.to_string()
    }

    /// Capture a single screenshot (one-shot, GDI). Use ScreenStream for continuous capture.
    pub fn capture(quality: &str, screen_index: Option<u32>) -> String {
        #[cfg(windows)]
        {
            match capture_single(quality, screen_index.unwrap_or(0)) {
                Ok((jpeg_base64, width, height)) => {
                    format!(
                        r#"{{"width":{},"height":{},"jpeg":"{}"}}"#,
                        width, height, jpeg_base64
                    )
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

// ── Raw pixel capture (GDI, shared by one-shot and GDI fallback) ───

#[cfg(windows)]
fn capture_raw(screen_index: u32) -> Result<(Vec<u8>, i32, i32), String> {
    let monitors = enum_display_monitors();
    if monitors.is_empty() {
        return Err("No monitors found".into());
    }

    let idx = screen_index as usize;
    if idx >= monitors.len() {
        return Err(format!(
            "Screen index {} not found. Available: {}",
            screen_index,
            monitors.len()
        ));
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
        if hdc_screen.is_null() {
            return Err("GetDC failed".into());
        }

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

        if BitBlt(
            hdc_mem, 0, 0, screen_w, screen_h, hdc_screen, cap_x, cap_y, SRCCOPY,
        ) == 0
        {
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
            bmiColors: [RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }; 1],
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
            0,
        );

        // Cleanup
        SelectObject(hdc_mem, old_bmp);
        DeleteObject(hbitmap as _);
        DeleteDC(hdc_mem);
        DeleteDC(hdc_screen);

        if ret == 0 {
            return Err("GetDIBits failed".into());
        }

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
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, JPEG_QUALITY);
    if encoder
        .encode(rgb, width as u32, height as u32, image::ExtendedColorType::Rgb8)
        .is_ok()
    {
        base64::engine::general_purpose::STANDARD.encode(&jpeg_buf)
    } else {
        String::new()
    }
}

// ── Diff computation (CPU fallback) ─────────────────────────────────

fn compute_changed_blocks(
    current: &[u8],
    previous: &[u8],
    width: i32,
    height: i32,
) -> Vec<BlockInfo> {
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

/// Merge adjacent/touching 64×64 blocks into larger rectangles to reduce JPEG header overhead.
fn merge_adjacent_blocks(blocks: &[BlockInfo]) -> Vec<BlockInfo> {
    if blocks.is_empty() {
        return vec![];
    }

    let mut merged: Vec<BlockInfo> = blocks.to_vec();
    let mut changed = true;

    while changed {
        changed = false;
        let mut new_merged: Vec<BlockInfo> = Vec::new();
        let mut used = vec![false; merged.len()];

        for i in 0..merged.len() {
            if used[i] {
                continue;
            }
            let mut cur = BlockInfo {
                x: merged[i].x,
                y: merged[i].y,
                w: merged[i].w,
                h: merged[i].h,
            };

            for j in i + 1..merged.len() {
                if used[j] {
                    continue;
                }

                // Horizontal merge: same y, same h, adjacent x
                if cur.y == merged[j].y && cur.h == merged[j].h {
                    if cur.x + cur.w == merged[j].x {
                        cur.w += merged[j].w;
                        used[j] = true;
                        changed = true;
                        continue;
                    }
                    if merged[j].x + merged[j].w == cur.x {
                        cur.x = merged[j].x;
                        cur.w += merged[j].w;
                        used[j] = true;
                        changed = true;
                        continue;
                    }
                }

                // Vertical merge: same x, same w, adjacent y
                if cur.x == merged[j].x && cur.w == merged[j].w {
                    if cur.y + cur.h == merged[j].y {
                        cur.h += merged[j].h;
                        used[j] = true;
                        changed = true;
                        continue;
                    }
                    if merged[j].y + merged[j].h == cur.y {
                        cur.y = merged[j].y;
                        cur.h += merged[j].h;
                        used[j] = true;
                        changed = true;
                    }
                }
            }
            new_merged.push(cur);
        }
        merged = new_merged;
    }

    merged
}

fn block_equals(
    current: &[u8],
    previous: &[u8],
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    full_width: i32,
) -> bool {
    for row in y..y + h {
        let off = (row * full_width + x) as usize * 3;
        let len = w as usize * 3;
        if current.get(off..off + len) != previous.get(off..off + len) {
            return false;
        }
    }
    true
}

/// Encode a single changed block region as a JSON fragment.
fn encode_diff_block(rgb: &[u8], full_width: i32, block: &BlockInfo) -> String {
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

// ── PowerShell screen listing ──────────────────────────────────────

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
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
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

                if parsing_key {
                    in_key.push(c);
                } else {
                    in_value.push(c);
                }
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
                    r#"{{"index":{},"width":{},"height":{},"caption":"{}({}x{})"}}"#,
                    idx,
                    width,
                    height,
                    caption.replace('"', "'"),
                    width,
                    height
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
    if data == 0 {
        return 0;
    }
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

// ── Win32 GDI + Monitor FFI ────────────────────────────────────────

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
    fn CreateCompatibleBitmap(
        hdc: *mut std::ffi::c_void,
        cx: i32,
        cy: i32,
    ) -> *mut std::ffi::c_void;
    fn SelectObject(hdc: *mut std::ffi::c_void, h: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    fn BitBlt(
        hdc: *mut std::ffi::c_void,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        hdcSrc: *mut std::ffi::c_void,
        x1: i32,
        y1: i32,
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
        lpfnEnum: Option<
            unsafe extern "system" fn(
                *mut std::ffi::c_void,
                *mut std::ffi::c_void,
                *mut RECT,
                isize,
            ) -> i32,
        >,
        dwData: isize,
    ) -> i32;
    fn GetMonitorInfoW(hMonitor: *mut std::ffi::c_void, lpmi: *mut MONITORINFO) -> i32;
}
