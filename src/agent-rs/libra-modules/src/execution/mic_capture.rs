use base64::Engine;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Microphone capture — Windows waveIn API-based, **continuous streaming**.
/// `start_capture` spawns a recording thread that keeps filling 1-second PCM
/// chunks into a shared buffer; the dispatcher drains them with `capture_chunk`
/// and streams them as `mic.data` frames over the WebSocket.
pub struct MicCapture;

static CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);
static CAPTURE_BUFFER: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static CAPTURE_READY: Mutex<bool> = Mutex::new(false);

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

    /// Start continuous capture on `device_index`: spawns a recording thread
    /// that fills 1-second PCM chunks until `stop_capture` is called.
    pub fn start_capture(device_index: u32) -> String {
        #[cfg(windows)]
        {
            let idx = device_index;
            let count = unsafe { waveInGetNumDevs() };
            if idx >= count {
                return format!(r#"{{"error":"Mic index {} not found. Available: {}"}}"#, idx, count);
            }
            *CAPTURE_BUFFER.lock().unwrap() = Vec::new();
            *CAPTURE_READY.lock().unwrap() = false;
            CAPTURE_ACTIVE.store(true, Ordering::Relaxed);

            std::thread::spawn(move || record_loop(idx));

            format!(r#"{{"status":"recording","sampleRate":16000,"channels":1,"bitsPerSample":16}}"#)
        }
        #[cfg(not(windows))]
        {
            r#"{"error":"Microphone capture only supported on Windows"}"#.to_string()
        }
    }

    /// True while the capture loop is running (dispatcher keeps streaming chunks).
    pub fn is_active() -> bool {
        CAPTURE_ACTIVE.load(Ordering::Relaxed)
    }

    /// Drain the most recent 1-second chunk as a `mic.data` frame, or "" if
    /// no new chunk is available yet.
    pub fn capture_chunk() -> String {
        let mut ready = CAPTURE_READY.lock().unwrap();
        if !*ready {
            return String::new();
        }
        *ready = false;

        let data = std::mem::take(&mut *CAPTURE_BUFFER.lock().unwrap());
        if data.is_empty() {
            return String::new();
        }

        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        format!(
            r#"{{"sampleRate":16000,"channels":1,"bitsPerSample":16,"data":"{}"}}"#,
            b64
        )
    }

    /// Stop capture and return a JSON status.
    pub fn stop_capture() -> String {
        CAPTURE_ACTIVE.store(false, Ordering::Relaxed);
        *CAPTURE_READY.lock().unwrap() = false;
        r#"{"status":"stopped"}"#.to_string()
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
fn record_loop(device_index: u32) {
    const SAMPLE_RATE: u32 = 16000;
    const CHANNELS: u16 = 1;
    const BITS_PER_SAMPLE: u16 = 16;
    const CHUNK_BYTES: usize = (SAMPLE_RATE * CHANNELS as u32 * (BITS_PER_SAMPLE as u32 / 8)) as usize;

    unsafe {
        let mut wfx = WAVEFORMATEX {
            wFormatTag: 1, // PCM
            nChannels: CHANNELS,
            nSamplesPerSec: SAMPLE_RATE,
            nAvgBytesPerSec: SAMPLE_RATE * (CHANNELS as u32) * (BITS_PER_SAMPLE as u32 / 8),
            nBlockAlign: (CHANNELS * BITS_PER_SAMPLE / 8) as u16,
            wBitsPerSample: BITS_PER_SAMPLE,
            cbSize: 0,
        };

        let mut hwi: *mut std::ffi::c_void = std::ptr::null_mut();
        if waveInOpen(&mut hwi, device_index, &mut wfx, 0, 0, CALLBACK_NULL) != 0 || hwi.is_null() {
            CAPTURE_ACTIVE.store(false, Ordering::Relaxed);
            return;
        }

        let mut buffer: Vec<u8> = vec![0u8; CHUNK_BYTES];

        while CAPTURE_ACTIVE.load(Ordering::Relaxed) {
            let hdr = WAVEHDR {
                lpData: buffer.as_mut_ptr() as isize,
                dwBufferLength: CHUNK_BYTES as u32,
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

            // Wait for the 1-second chunk to fill (polling, no callback).
            let start = std::time::Instant::now();
            while (*hdr_ptr).dwFlags & WHDR_DONE == 0
                && start.elapsed() < std::time::Duration::from_millis(2500)
            {
                if !CAPTURE_ACTIVE.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }

            waveInStop(hwi);
            waveInReset(hwi);
            waveInUnprepareHeader(hwi, hdr_ptr, std::mem::size_of::<WAVEHDR>() as u32);

            if (*hdr_ptr).dwBytesRecorded > 0 && CAPTURE_ACTIVE.load(Ordering::Relaxed) {
                let recorded = std::slice::from_raw_parts(
                    buffer.as_ptr(),
                    (*hdr_ptr).dwBytesRecorded as usize,
                );
                *CAPTURE_BUFFER.lock().unwrap() = recorded.to_vec();
                *CAPTURE_READY.lock().unwrap() = true;
            }
            drop(hdr_box);
        }

        waveInClose(hwi);
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
