use base64::Engine;
use std::sync::Mutex;

/// Microphone capture — Windows waveIn API-based.
/// Uses raw Win32 FFI for device enumeration and audio capture.
pub struct MicCapture;

static CAPTURE_BUFFER: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static CAPTURE_ACTIVE: Mutex<bool> = Mutex::new(false);

impl MicCapture {
    /// List available microphone devices as JSON array.
    pub fn list_devices() -> String {
        #[cfg(windows)]
        {
            let devices = list_mic_devices();
            if !devices.is_empty() {
                let items: Vec<String> = devices.iter().enumerate().map(|(i, d)| {
                    format!(r#"{{"index":{},"name":"{}","channels":{}}}"#, i, d.name, d.channels)
                }).collect();
                return format!("[{}]", items.join(","));
            }
        }
        "[]".to_string()
    }

    /// Start audio capture from the specified device.
    /// Returns JSON status with sample format info.
    pub fn start_capture(_device_index: u32) -> String {
        #[cfg(windows)]
        {
            let idx = _device_index;
            let count = unsafe { waveInGetNumDevs() };
            if idx >= count {
                return format!(r#"{{"error":"Mic index {} not found. Avaliable: {}"}}"#, idx, count);
            }
            *CAPTURE_ACTIVE.lock().unwrap() = true;
            *CAPTURE_BUFFER.lock().unwrap() = Vec::new();

            // Start recording in a background thread
            std::thread::spawn(move || {
                record_chunk(idx);
            });

            return format!(r#"{{"status":"recording","sampleRate":16000,"channels":1,"bitsPerSample":16}}"#);
        }
        #[cfg(not(windows))]
        {
            r#"{"error":"Microphone capture only supported on Windows"}"#.to_string()
        }
    }

    /// Stop audio capture and return the recorded PCM data as base64.
    pub fn stop_capture() -> String {
        #[cfg(windows)]
        {
            *CAPTURE_ACTIVE.lock().unwrap() = false;
            let buffer = std::mem::take(&mut *CAPTURE_BUFFER.lock().unwrap());

            if buffer.is_empty() {
                return r#"{"status":"stopped","data":"","sampleRate":16000,"channels":1,"bitsPerSample":16}"#.to_string();
            }

            let base64_data = base64::engine::general_purpose::STANDARD.encode(&buffer);
            format!(r#"{{"status":"stopped","data":"{}","sampleRate":16000,"channels":1,"bitsPerSample":16,"durationMs":{}}}"#,
                base64_data,
                (buffer.len() * 1000) / (16000 * 2) // 16-bit mono → bytes per ms = sampleRate * 2
            )
        }
        #[cfg(not(windows))]
        {
            r#"{"status":"stopped"}"#.to_string()
        }
    }
}

#[cfg(windows)]
struct MicDevice {
    name: String,
    channels: u16,
}

#[cfg(windows)]
fn list_mic_devices() -> Vec<MicDevice> {
    let mut devices = Vec::new();
    unsafe {
        let count = waveInGetNumDevs();
        for i in 0..count {
            let mut caps: WAVEINCAPSW = std::mem::zeroed();
            if waveInGetDevCapsW(i, &mut caps, std::mem::size_of::<WAVEINCAPSW>() as u32) == 0 {
                let name = String::from_utf16_lossy(&caps.szPname)
                    .trim_end_matches('\0')
                    .to_string();
                devices.push(MicDevice {
                    name,
                    channels: caps.wChannels,
                });
            }
        }
    }
    devices
}

#[cfg(windows)]
fn record_chunk(device_index: u32) {
    const SAMPLE_RATE: u32 = 16000;
    const BITS_PER_SAMPLE: u16 = 16;
    const CHANNELS: u16 = 1;
    const BUFFER_MS: u32 = 5000; // Record 5 seconds

    unsafe {
        let mut wfx = WAVEFORMATEX {
            wFormatTag: 1, // PCM
            nChannels: CHANNELS as u16,
            nSamplesPerSec: SAMPLE_RATE,
            nAvgBytesPerSec: SAMPLE_RATE * (CHANNELS as u32) * (BITS_PER_SAMPLE as u32 / 8),
            nBlockAlign: (CHANNELS * BITS_PER_SAMPLE / 8) as u16,
            wBitsPerSample: BITS_PER_SAMPLE,
            cbSize: 0,
        };

        let mut hwi: *mut std::ffi::c_void = std::ptr::null_mut();
        let result = waveInOpen(
            &mut hwi,
            device_index,
            &mut wfx,
            0, 0, // No callback (we use polling via separate thread for simplicity)
            CALLBACK_NULL,
        );

        if result != 0 || hwi.is_null() {
            return;
        }

        let buffer_bytes = (SAMPLE_RATE * (CHANNELS as u32) * (BITS_PER_SAMPLE as u32 / 8) * BUFFER_MS / 1000) as usize;
        let buffer: Vec<u8> = vec![0u8; buffer_bytes];

        let hdr = WAVEHDR {
            lpData: buffer.as_ptr() as _,
            dwBufferLength: buffer_bytes as u32,
            dwBytesRecorded: 0,
            dwUser: 0,
            dwFlags: 0,
            dwLoops: 0,
            lpNext: std::ptr::null_mut(),
            reserved: 0,
        };

        let mut hdr_box = Box::new(hdr);
        let hdr_ptr: *mut WAVEHDR = &mut *hdr_box;

        waveInPrepareHeader(hwi, hdr_ptr, std::mem::size_of::<WAVEHDR>() as u32);
        waveInAddBuffer(hwi, hdr_ptr, std::mem::size_of::<WAVEHDR>() as u32);
        waveInStart(hwi);

        // Wait for buffer to fill (poll)
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis((BUFFER_MS + 2000) as u64);
        while *CAPTURE_ACTIVE.lock().unwrap() && start.elapsed() < timeout {
            if ((*hdr_ptr).dwFlags & WHDR_DONE) != 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        waveInStop(hwi);
        waveInReset(hwi);

        if (*hdr_ptr).dwBytesRecorded > 0 {
            let recorded = std::slice::from_raw_parts(buffer.as_ptr(), (*hdr_ptr).dwBytesRecorded as usize);
            *CAPTURE_BUFFER.lock().unwrap() = recorded.to_vec();
        }

        waveInUnprepareHeader(hwi, hdr_ptr, std::mem::size_of::<WAVEHDR>() as u32);
        waveInClose(hwi);
        // hdr_box will be dropped, which is fine since we're done with waveIn
        std::mem::forget(hdr_box); // Prevent double-free since waveIn owns the buffer during recording
        let _ = buffer; // Prevent drop of buffer while in use
    }
}

// ── winmm.dll FFI ────────────────────────────────────────────────────────

#[cfg(windows)]
const WHDR_DONE: u32 = 0x01;
#[cfg(windows)]
const CALLBACK_NULL: u32 = 0x00000000;

#[cfg(windows)]
#[repr(C)]
struct WAVEINCAPSW {
    wMid: u16,
    wPid: u16,
    vDriverVersion: u32,
    szPname: [u16; 32],
    dwFormats: u32,
    wChannels: u16,
    wReserved1: u16,
}

#[cfg(windows)]
#[repr(C)]
struct WAVEFORMATEX {
    wFormatTag: u16,
    nChannels: u16,
    nSamplesPerSec: u32,
    nAvgBytesPerSec: u32,
    nBlockAlign: u16,
    wBitsPerSample: u16,
    cbSize: u16,
}

#[cfg(windows)]
#[repr(C)]
struct WAVEHDR {
    lpData: isize,
    dwBufferLength: u32,
    dwBytesRecorded: u32,
    dwUser: usize,
    dwFlags: u32,
    dwLoops: u32,
    lpNext: *mut WAVEHDR,
    reserved: usize,
}

#[cfg(windows)]
extern "system" {
    fn waveInGetNumDevs() -> u32;
    fn waveInGetDevCapsW(uDeviceID: u32, pwic: *mut WAVEINCAPSW, cbwic: u32) -> i32;
    fn waveInOpen(
        phwi: *mut *mut std::ffi::c_void,
        uDeviceID: u32,
        lpFormat: *mut WAVEFORMATEX,
        dwCallback: usize,
        dwInstance: usize,
        fdwOpen: u32,
    ) -> i32;
    fn waveInPrepareHeader(hwi: *mut std::ffi::c_void, pwh: *mut WAVEHDR, cbwh: u32) -> i32;
    fn waveInUnprepareHeader(hwi: *mut std::ffi::c_void, pwh: *mut WAVEHDR, cbwh: u32) -> i32;
    fn waveInAddBuffer(hwi: *mut std::ffi::c_void, pwh: *mut WAVEHDR, cbwh: u32) -> i32;
    fn waveInStart(hwi: *mut std::ffi::c_void) -> i32;
    fn waveInStop(hwi: *mut std::ffi::c_void) -> i32;
    fn waveInReset(hwi: *mut std::ffi::c_void) -> i32;
    fn waveInClose(hwi: *mut std::ffi::c_void) -> i32;
}
