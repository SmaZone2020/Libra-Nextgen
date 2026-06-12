/// Decode shell output bytes to a UTF-8 String.
/// On Windows, uses MultiByteToWideChar with the system OEM code page
/// (e.g., CP936/GBK on Chinese Windows) since cmd.exe outputs in the
/// console's OEM encoding when stdout is piped.
/// On Linux, shells already output UTF-8.

#[cfg(windows)]
pub fn decode_shell_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
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
}

#[cfg(not(windows))]
pub fn decode_shell_bytes(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}
