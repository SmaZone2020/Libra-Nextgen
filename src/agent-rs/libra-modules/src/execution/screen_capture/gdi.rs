//! GDI-based raw pixel capture and monitor enumeration.

use super::win32_ffi::*;

/// Capture the raw RGB pixels of a monitor via GDI BitBlt.
pub fn capture_raw(screen_index: u32) -> Result<(Vec<u8>, i32, i32), String> {
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

/// Capture a single screenshot (one-shot) and return base64 JPEG.
pub fn capture_single(_quality: &str, screen_index: u32) -> Result<(String, i32, i32), String> {
    let (rgb, w, h) = capture_raw(screen_index)?;
    Ok((super::rgb_to_jpeg_base64(&rgb, w, h), w, h))
}

/// List monitors via EnumDisplayMonitors.
pub fn enum_display_monitors() -> Vec<MonitorRect> {
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

// ── PowerShell screen listing ──────────────────────────────────────

/// List screens via PowerShell WMI (primary fallback chain).
pub fn ps_list_screens() -> Option<String> {
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
