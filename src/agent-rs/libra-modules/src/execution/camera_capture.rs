use base64::Engine;

/// Camera capture — Windows-only via Media Foundation SourceReader.
pub struct CameraCapture;

/// Result of a camera capture — keyframe, diff blocks, or no change.
pub enum CameraFrame {
    Keyframe { width: u32, height: u32, jpeg: String },
    Diff { blocks_json: String },
    Empty,
}

/// Stateful camera stream using MF SourceReader with frame diff.
#[cfg(windows)]
pub struct CameraStream {
    reader: windows::Win32::Media::MediaFoundation::IMFSourceReader,
    width: u32,
    height: u32,
    prev_rgb: Option<Vec<u8>>,
}

#[cfg(not(windows))]
pub struct CameraStream;

const BLOCK_SIZE: u32 = 64;
const DIFF_THRESHOLD_PERCENT: u32 = 60;

impl CameraCapture {
    pub fn list_cameras() -> String {
        #[cfg(windows)]
        {
            match mf_list_cameras() {
                Ok(json) => return json,
                Err(e) => {
                    libra_common::dlog!("[camera] list failed: {e}");
                }
            }
        }
        r#"{"cameras":[],"note":"Camera enumeration not supported on this platform"}"#.to_string()
    }

    pub fn capture(camera_index: u32) -> String {
        #[cfg(windows)]
        {
            match mf_capture_one(camera_index) {
                Ok(b64) => format!(r#"{{"data":"{}"}}"#, b64),
                Err(e) => format!(r#"{{"error":"{}"}}"#, e.replace('"', "'")),
            }
        }
        #[cfg(not(windows))]
        {
            r#"{"error":"Camera capture only supported on Windows"}"#.to_string()
        }
    }
}
// APPEND_MARKER_1

// ── CameraStream: Media Foundation SourceReader with diff ────────────

#[cfg(windows)]
impl CameraStream {
    pub fn new(camera_index: u32) -> Result<Self, String> {
        use windows::Win32::Media::MediaFoundation::*;
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(|e| format!("MFStartup: {e}"))?;
        }

        let source = mf_activate_device(camera_index)?;

        let reader = unsafe {
            MFCreateSourceReaderFromMediaSource(&source, None)
                .map_err(|e| format!("MFCreateSourceReaderFromMediaSource: {e}"))?
        };

        let media_type = unsafe {
            MFCreateMediaType().map_err(|e| format!("MFCreateMediaType: {e}"))?
        };
        unsafe {
            media_type
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| format!("SetGUID major: {e}"))?;
            media_type
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
                .map_err(|e| format!("SetGUID subtype: {e}"))?;
            reader
                .SetCurrentMediaType(
                    MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
                    None,
                    &media_type,
                )
                .map_err(|e| format!("SetCurrentMediaType: {e}"))?;
        }

        let actual_type = unsafe {
            reader
                .GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32)
                .map_err(|e| format!("GetCurrentMediaType: {e}"))?
        };

        let (width, height) = unsafe {
            let frame_size = actual_type
                .GetUINT64(&MF_MT_FRAME_SIZE)
                .map_err(|e| format!("GetUINT64 frame_size: {e}"))?;
            ((frame_size >> 32) as u32, frame_size as u32)
        };

        if width == 0 || height == 0 {
            return Err("Camera reported 0x0 resolution".into());
        }

        Ok(Self { reader, width, height, prev_rgb: None })
    }

    /// Read a frame and return keyframe/diff/empty.
    pub fn capture_frame(&mut self) -> Result<CameraFrame, String> {
        let rgb = self.read_rgb_frame()?;

        let need_keyframe = match &self.prev_rgb {
            None => true,
            Some(prev) => prev.len() != rgb.len(),
        };

        if need_keyframe {
            let jpeg = rgb_to_jpeg(&rgb, self.width, self.height)?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg);
            self.prev_rgb = Some(rgb);
            return Ok(CameraFrame::Keyframe {
                width: self.width,
                height: self.height,
                jpeg: b64,
            });
        }

        let prev = self.prev_rgb.as_ref().unwrap();
        let blocks = compute_changed_blocks(&rgb, prev, self.width, self.height);

        if blocks.is_empty() {
            return Ok(CameraFrame::Empty);
        }

        let blocks_x = (self.width + BLOCK_SIZE - 1) / BLOCK_SIZE;
        let blocks_y = (self.height + BLOCK_SIZE - 1) / BLOCK_SIZE;
        let total_blocks = blocks_x * blocks_y;

        if blocks.len() as u32 > total_blocks * DIFF_THRESHOLD_PERCENT / 100 {
            let jpeg = rgb_to_jpeg(&rgb, self.width, self.height)?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg);
            self.prev_rgb = Some(rgb);
            return Ok(CameraFrame::Keyframe {
                width: self.width,
                height: self.height,
                jpeg: b64,
            });
        }

        let merged = merge_adjacent_blocks(&blocks);
        self.prev_rgb = Some(rgb.clone());

        let encoded: Vec<String> = merged
            .iter()
            .map(|b| encode_diff_block(&rgb, self.width, b))
            .collect();

        Ok(CameraFrame::Diff {
            blocks_json: format!("[{}]", encoded.join(",")),
        })
    }
// APPEND_MARKER_2

    fn read_rgb_frame(&self) -> Result<Vec<u8>, String> {
        use windows::Win32::Media::MediaFoundation::*;

        let sample = unsafe {
            let mut flags = 0u32;
            let mut sample = None;
            self.reader
                .ReadSample(
                    MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
                    0,
                    None,
                    Some(&mut flags),
                    None,
                    Some(&mut sample),
                )
                .map_err(|e| format!("ReadSample: {e}"))?;
            sample.ok_or_else(|| "ReadSample returned no sample".to_string())?
        };

        let buffer = unsafe {
            sample
                .ConvertToContiguousBuffer()
                .map_err(|e| format!("ConvertToContiguousBuffer: {e}"))?
        };

        let mut ptr = std::ptr::null_mut();
        let mut cur_len = 0u32;
        unsafe {
            buffer
                .Lock(&mut ptr, None, Some(&mut cur_len))
                .map_err(|e| format!("Lock: {e}"))?;
        }

        let nv12_data = unsafe { std::slice::from_raw_parts(ptr, cur_len as usize) };
        let rgb = nv12_to_rgb(nv12_data, self.width, self.height);

        unsafe {
            let _ = buffer.Unlock();
        }

        Ok(rgb)
    }

    /// Legacy API — returns full frame as base64 JPEG (no diff).
    pub fn capture_frame_full(&self) -> Result<String, String> {
        let rgb = self.read_rgb_frame()?;
        let jpeg = rgb_to_jpeg(&rgb, self.width, self.height)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(&jpeg))
    }
}

#[cfg(not(windows))]
impl CameraStream {
    pub fn new(_camera_index: u32) -> Result<Self, String> {
        Err("Camera capture only supported on Windows".into())
    }
    pub fn capture_frame(&mut self) -> Result<CameraFrame, String> {
        Err("Camera capture only supported on Windows".into())
    }
    pub fn capture_frame_full(&self) -> Result<String, String> {
        Err("Camera capture only supported on Windows".into())
    }
}
// APPEND_MARKER_3

// ── Block diff helpers ──────────────────────────────────────────────

#[derive(Clone)]
struct BlockInfo {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

#[cfg(windows)]
fn compute_changed_blocks(current: &[u8], previous: &[u8], width: u32, height: u32) -> Vec<BlockInfo> {
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

#[cfg(windows)]
fn block_equals(current: &[u8], previous: &[u8], x: u32, y: u32, w: u32, h: u32, full_width: u32) -> bool {
    for row in y..y + h {
        let off = (row * full_width + x) as usize * 3;
        let len = w as usize * 3;
        if current.get(off..off + len) != previous.get(off..off + len) {
            return false;
        }
    }
    true
}

#[cfg(windows)]
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
            if used[i] { continue; }
            let mut cur = merged[i].clone();

            for j in i + 1..merged.len() {
                if used[j] { continue; }

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

#[cfg(windows)]
fn encode_diff_block(rgb: &[u8], full_width: u32, block: &BlockInfo) -> String {
    let mut block_pixels = Vec::with_capacity((block.w * block.h * 3) as usize);
    for row in block.y..block.y + block.h {
        let off = (row * full_width + block.x) as usize * 3;
        let len = block.w as usize * 3;
        block_pixels.extend_from_slice(&rgb[off..off + len]);
    }

    let jpeg = rgb_to_jpeg(&block_pixels, block.w, block.h).unwrap_or_default();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg);
    format!(
        r#"{{"x":{},"y":{},"w":{},"h":{},"data":"{}"}}"#,
        block.x, block.y, block.w, block.h, b64
    )
}
// APPEND_MARKER_4

// ── MF device helpers ───────────────────────────────────────────────

#[cfg(windows)]
fn mf_activate_device(
    camera_index: u32,
) -> Result<windows::Win32::Media::MediaFoundation::IMFMediaSource, String> {
    use windows::Win32::Media::MediaFoundation::*;

    unsafe {
        let mut attrs = None;
        MFCreateAttributes(&mut attrs, 1).map_err(|e| format!("MFCreateAttributes: {e}"))?;
        let attrs = attrs.unwrap();
        attrs
            .SetGUID(
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
            )
            .map_err(|e| format!("SetGUID source_type: {e}"))?;

        let mut devices: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0u32;
        MFEnumDeviceSources(&attrs, &mut devices, &mut count)
            .map_err(|e| format!("MFEnumDeviceSources: {e}"))?;

        if count == 0 || devices.is_null() {
            return Err("No camera devices found".into());
        }

        if camera_index >= count {
            return Err(format!(
                "Camera index {} out of range (found {})",
                camera_index, count
            ));
        }

        let device_slice = std::slice::from_raw_parts(devices, count as usize);
        let activate = device_slice[camera_index as usize]
            .as_ref()
            .ok_or_else(|| "Null IMFActivate".to_string())?;

        let source: IMFMediaSource = activate
            .ActivateObject()
            .map_err(|e| format!("ActivateObject: {e}"))?;

        windows::Win32::System::Com::CoTaskMemFree(Some(devices as *const _));
        Ok(source)
    }
}

#[cfg(windows)]
fn mf_list_cameras() -> Result<String, String> {
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    use windows::core::PWSTR;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(|e| format!("MFStartup: {e}"))?;

        let mut attrs = None;
        MFCreateAttributes(&mut attrs, 1).map_err(|e| format!("MFCreateAttributes: {e}"))?;
        let attrs = attrs.unwrap();
        attrs
            .SetGUID(
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
            )
            .map_err(|e| format!("SetGUID: {e}"))?;

        let mut devices: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0u32;
        MFEnumDeviceSources(&attrs, &mut devices, &mut count)
            .map_err(|e| format!("MFEnumDeviceSources: {e}"))?;

        if count == 0 || devices.is_null() {
            return Ok("[]".to_string());
        }

        let device_slice = std::slice::from_raw_parts(devices, count as usize);
        let mut result = Vec::new();

        for i in 0..count {
            if let Some(activate) = device_slice[i as usize].as_ref() {
                let name = {
                    let mut pwstr = PWSTR::null();
                    let mut len = 0u32;
                    if activate
                        .GetAllocatedString(
                            &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
                            &mut pwstr,
                            &mut len,
                        )
                        .is_ok()
                    {
                        let s = pwstr.to_string().unwrap_or_default();
                        windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.0 as *const _));
                        s
                    } else {
                        format!("Camera {}", i)
                    }
                };
                result.push(format!(
                    r#"{{"index":{},"name":"{}","characteristics":[]}}"#,
                    i,
                    name.replace('"', "'")
                ));
            }
        }

        windows::Win32::System::Com::CoTaskMemFree(Some(devices as *const _));
        Ok(format!("[{}]", result.join(",")))
    }
}

#[cfg(windows)]
fn mf_capture_one(camera_index: u32) -> Result<String, String> {
    let mut stream = CameraStream::new(camera_index)?;
    stream.capture_frame_full()
}

// ── NV12 → RGB conversion (BT.709) ─────────────────────────────────

#[cfg(windows)]
fn nv12_to_rgb(nv12: &[u8], width: u32, height: u32) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let y_plane_size = w * h;
    let mut rgb = vec![0u8; w * h * 3];

    for row in 0..h {
        for col in 0..w {
            let y_idx = row * w + col;
            let uv_idx = y_plane_size + (row / 2) * w + (col & !1);

            let y = nv12.get(y_idx).copied().unwrap_or(0) as i32;
            let u = nv12.get(uv_idx).copied().unwrap_or(128) as i32;
            let v = nv12.get(uv_idx + 1).copied().unwrap_or(128) as i32;

            let c = y - 16;
            let d = u - 128;
            let e = v - 128;

            let r = ((298 * c + 409 * e + 128) >> 8).clamp(0, 255) as u8;
            let g = ((298 * c - 100 * d - 208 * e + 128) >> 8).clamp(0, 255) as u8;
            let b = ((298 * c + 516 * d + 128) >> 8).clamp(0, 255) as u8;

            let out_idx = (row * w + col) * 3;
            rgb[out_idx] = r;
            rgb[out_idx + 1] = g;
            rgb[out_idx + 2] = b;
        }
    }
    rgb
}

#[cfg(windows)]
fn rgb_to_jpeg(rgb: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    use image::codecs::jpeg::JpegEncoder;
    use std::io::Cursor;

    let mut buf = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, 60);
    encoder
        .encode(rgb, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG encode: {e}"))?;
    Ok(buf.into_inner())
}