/// Decode shell output bytes to a UTF-8 String.
///
/// Heuristic (order matters):
///   1. Strict UTF-8 first — valid UTF-8 (or pure ASCII) is used as-is.
///      Windows 10 1903+ cmd.exe sometimes emits UTF-8 for piped output
///      (depends on the parent's console/code-page environment), so the
///      output encoding is NOT reliably the OEM code page.
///   2. Fallback on Windows: MultiByteToWideChar with the system OEM code
///      page (e.g. CP936/GBK on Chinese Windows) since cmd.exe falls back to
///      the OEM encoding when it cannot use UTF-8.
///   3. Non-Windows fallback: lossy UTF-8.
///
/// GBK bytes almost never form valid UTF-8 sequences, and UTF-8 bytes decode
/// as mojibake under GBK — so strict-first makes the heuristic safe.

#[cfg(windows)]
pub fn decode_shell_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    unsafe {
        let len = MultiByteToWideChar(
            1, // CP_OEMCP
            0,
            bytes.as_ptr(),
            bytes.len() as i32,
            std::ptr::null_mut(),
            0,
        );
        if len == 0 {
            return String::from_utf8_lossy(bytes).to_string();
        }
        let mut wide: Vec<u16> = vec![0; len as usize];
        MultiByteToWideChar(
            1, // CP_OEMCP
            0,
            bytes.as_ptr(),
            bytes.len() as i32,
            wide.as_mut_ptr(),
            len,
        );
        let os_str = <std::ffi::OsString as std::os::windows::ffi::OsStringExt>::from_wide(&wide);
        os_str.to_string_lossy().to_string()
    }
}

#[cfg(windows)]
extern "system" {
    fn MultiByteToWideChar(
        CodePage: u32,
        dwFlags: u32,
        lpMultiByteStr: *const u8,
        cbMultiByte: i32,
        lpWideCharStr: *mut u16,
        cchWideChar: i32,
    ) -> i32;
    fn GetOEMCP() -> u32;
}

#[cfg(not(windows))]
pub fn decode_shell_bytes(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        s.to_string()
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_and_ascii_pass_through() {
        assert_eq!(decode_shell_bytes(b"hello\n"), "hello\n");
        assert_eq!(
            decode_shell_bytes("中文输出测试\r\n".as_bytes()),
            "中文输出测试\r\n"
        );
    }

    #[test]
    fn gbk_bytes_decode_via_fallback() {
        let gbk = [
            0xD6u8, 0xD0, 0xCE, 0xC4, 0xCA, 0xE4, 0xB3, 0xF6, 0xB2, 0xE2, 0xCA, 0xD4,
        ];
        let decoded = decode_shell_bytes(&gbk);
        #[cfg(windows)]
        {
            let oem = unsafe { GetOEMCP() };
            if oem == 936 {
                assert_eq!(decoded, "中文输出测试", "decoded: {decoded}");
            } else {
                eprintln!("OEM code page {oem} — skipping GBK exact-match assertion");
                assert!(!decoded.is_empty(), "OEM fallback produced empty output");
            }
        }
        #[cfg(not(windows))]
        assert!(decoded.contains('\u{FFFD}'), "lossy fallback: {decoded}");
    }

    #[test]
    fn empty_input_returns_empty() {
        assert_eq!(decode_shell_bytes(b""), "");
    }
}
