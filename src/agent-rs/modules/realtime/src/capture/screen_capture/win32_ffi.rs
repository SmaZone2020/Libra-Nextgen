//! Win32 GDI + Monitor FFI declarations for GDI screen capture.

#[cfg(windows)]
pub const SRCCOPY: u32 = 0x00CC0020;

#[cfg(windows)]
#[derive(Clone, Debug)]
pub struct MonitorRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[cfg(windows)]
#[repr(C)]
pub struct RECT {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[cfg(windows)]
#[repr(C)]
pub struct MONITORINFO {
    pub cbSize: u32,
    pub rcMonitor: RECT,
    pub rcWork: RECT,
    pub dwFlags: u32,
}

#[cfg(windows)]
#[repr(C)]
pub struct MONITORINFOEXW {
    pub monitorInfo: MONITORINFO,
    pub szDevice: [u16; 32],
}

#[cfg(windows)]
#[repr(C)]
pub struct BITMAPINFOHEADER {
    pub biSize: u32,
    pub biWidth: i32,
    pub biHeight: i32,
    pub biPlanes: u16,
    pub biBitCount: u16,
    pub biCompression: u32,
    pub biSizeImage: u32,
    pub biXPelsPerMeter: i32,
    pub biYPelsPerMeter: i32,
    pub biClrUsed: u32,
    pub biClrImportant: u32,
}

#[cfg(windows)]
#[repr(C)]
pub struct RGBQUAD {
    pub rgbBlue: u8,
    pub rgbGreen: u8,
    pub rgbRed: u8,
    pub rgbReserved: u8,
}

#[cfg(windows)]
#[repr(C)]
pub struct BITMAPINFO {
    pub bmiHeader: BITMAPINFOHEADER,
    pub bmiColors: [RGBQUAD; 1],
}

#[cfg(windows)]
extern "system" {
    pub fn GetDC(hWnd: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    pub fn CreateCompatibleDC(hdc: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    pub fn CreateCompatibleBitmap(
        hdc: *mut std::ffi::c_void,
        cx: i32,
        cy: i32,
    ) -> *mut std::ffi::c_void;
    pub fn SelectObject(hdc: *mut std::ffi::c_void, h: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    pub fn BitBlt(
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
    pub fn GetDIBits(
        hdc: *mut std::ffi::c_void,
        hbm: *mut std::ffi::c_void,
        start: u32,
        lines: u32,
        bits: *mut std::ffi::c_void,
        lpbmi: *mut BITMAPINFO,
        usage: u32,
    ) -> i32;
    pub fn DeleteDC(hdc: *mut std::ffi::c_void) -> i32;
    pub fn DeleteObject(ho: *mut std::ffi::c_void) -> i32;
    pub fn EnumDisplayMonitors(
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
    pub fn GetMonitorInfoW(hMonitor: *mut std::ffi::c_void, lpmi: *mut MONITORINFO) -> i32;
}
