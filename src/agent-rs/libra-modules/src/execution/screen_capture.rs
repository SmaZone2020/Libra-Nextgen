//! Screen capture — DXGI Desktop Duplication API with GDI fallback.
//! Port of Modules/Execution/ScreenCapture.cs
//!
//! Uses DXGI for low-latency GPU-accelerated capture (Win8+).
//! Falls back to GDI BitBlt when DXGI is unavailable.
//! First frame sends a full keyframe; subsequent frames use DirtyRects
//! from DXGI to send only changed 64×64 blocks as JPEG diffs.

use base64::Engine;

use self::gdi::{capture_raw, capture_single, enum_display_monitors, ps_list_screens};

mod dxgi;
mod gdi;
mod win32_ffi;

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

/// Result of a streaming capture — either a full keyframe, diff blocks, or no change.
pub enum ScreenFrame {
    Keyframe { width: i32, height: i32, jpeg: String },
    Diff { blocks_json: String },
    /// No visual change since last frame — engine should skip sending.
    Empty,
}

// ── ScreenStream ────────────────────────────────────────────────────

/// Stateful screen stream that tracks the previous frame for diff computation.
/// Uses DXGI Desktop Duplication when available, falls back to GDI.
pub struct ScreenStream {
    #[cfg(windows)]
    dxgi: Option<dxgi::DxgiDuplicator>,
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
                    f @ ScreenFrame::Keyframe { width, .. } if width > 0 => return f,
                    f @ ScreenFrame::Diff { .. } => return f,
                    _ => { /* DXGI returned dummy frame — fall through to GDI */ }
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
                match dxgi::DxgiDuplicator::new(screen_index) {
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
                self.process_frame_cpu(&rgb, w, h, quality)
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
                self.process_frame_cpu(&rgb, w, h, quality)
            }
            Err(_) => {
                self.prev_rgb = None;
                ScreenFrame::Keyframe { width: 0, height: 0, jpeg: String::new() }
            }
        }
    }

    /// CPU diff path — resize to quality cap, diff, merge adjacent blocks, encode.
    fn process_frame_cpu(&mut self, rgb: &[u8], w: i32, h: i32, quality: &str) -> ScreenFrame {
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
            self.prev_rgb = Some(working_rgb.clone());
            self.prev_width = working_w;
            self.prev_height = working_h;
            return ScreenFrame::Keyframe {
                width: working_w,
                height: working_h,
                jpeg: rgb_to_jpeg_base64(&working_rgb, working_w, working_h),
            };
        }

        let prev = self.prev_rgb.as_ref().unwrap();
        let blocks = super::diff_codec::compute_changed_blocks(&working_rgb, prev, working_w, working_h);

        let blocks_x = (working_w + super::diff_codec::BLOCK_SIZE - 1) / super::diff_codec::BLOCK_SIZE;
        let blocks_y = (working_h + super::diff_codec::BLOCK_SIZE - 1) / super::diff_codec::BLOCK_SIZE;
        let total_blocks = blocks_x * blocks_y;

        if blocks.len() as i32 > total_blocks * DIFF_THRESHOLD_PERCENT / 100 {
            self.prev_rgb = Some(working_rgb.clone());
            self.prev_width = working_w;
            self.prev_height = working_h;
            return ScreenFrame::Keyframe {
                width: working_w,
                height: working_h,
                jpeg: rgb_to_jpeg_base64(&working_rgb, working_w, working_h),
            };
        }

        let merged = super::diff_codec::merge_adjacent_blocks(&blocks);

        // Store resized frame for next diff
        self.prev_rgb = Some(working_rgb.clone());
        self.prev_width = working_w;
        self.prev_height = working_h;

        let encoded: Vec<String> = merged
            .iter()
            .map(|b| super::diff_codec::encode_diff_block(&working_rgb, working_w, b, |pixels, w, h| {
                rgb_to_jpeg(pixels, w, h)
            }))
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

// ── JPEG encoding ──────────────────────────────────────────────────

/// Encode RGB pixels to JPEG and return base64 string.
fn rgb_to_jpeg(rgb: &[u8], width: i32, height: i32) -> Option<Vec<u8>> {
    let mut jpeg_buf = Vec::new();
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, JPEG_QUALITY);
    if encoder
        .encode(rgb, width as u32, height as u32, image::ExtendedColorType::Rgb8)
        .is_ok()
    {
        Some(jpeg_buf)
    } else {
        None
    }
}

pub(super) fn rgb_to_jpeg_base64(rgb: &[u8], width: i32, height: i32) -> String {
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
