//! In-memory module loading with a uniform ABI.
//!
//! A "module" is a platform shared object (`cdylib`) that exports a single
//! entry point:
//!
//! ```text
//! unsafe extern "system" fn module_main(
//!     input: *const u8, input_len: usize,
//!     output: *mut u8, output_cap: usize,
//! ) -> usize
//! ```
//!
//! The returned value is the number of bytes written to `output`. Loading is
//! performed entirely in memory:
//! - Windows: "phantom" DLL load — `LoadLibraryW` from a temp file that is
//!   deleted immediately after mapping (no persistent disk footprint).
//! - Linux: `memfd_create` + `dlopen` (never touches disk).

pub type ModuleMainFn = unsafe extern "system" fn(*const u8, usize, *mut u8, usize) -> usize;
pub type ModuleNameFn = extern "C" fn() -> *const u8;

/// A loaded module handle. The underlying image is intentionally leaked so the
/// entry point stays valid for the lifetime of the process.
pub struct LoadedModule {
    pub main: ModuleMainFn,
    /// Module self-identification (exported as `module_name`). Used to detect
    /// content mismatches (e.g. a corrupted download) before execution.
    pub name: String,
}

/// Load a module from raw bytes and resolve the named export.
pub fn load_module(bytes: &[u8], export: &str) -> Result<LoadedModule, String> {
    if bytes.is_empty() {
        return Err("empty module bytes".into());
    }

    #[cfg(target_os = "windows")]
    {
        return unsafe { windows::load(bytes, export) };
    }
    #[cfg(target_os = "linux")]
    {
        return unsafe { linux::load(bytes, export) };
    }
    #[cfg(target_os = "macos")]
    {
        return unsafe { macos::load(bytes, export) };
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = bytes;
        let _ = export;
        return Err("unsupported platform for in-memory module loading".into());
    }
}

/// Build a `LoadedModule` from raw symbol pointers (platform-agnostic).
unsafe fn build_loaded(
    main_sym: *mut u8,
    name_sym: *mut u8,
    export: &str,
) -> Result<LoadedModule, String> {
    if main_sym.is_null() {
        return Err(format!("export '{}' not found", export));
    }
    let main: ModuleMainFn = std::mem::transmute(main_sym);

    let name = if name_sym.is_null() {
        String::new()
    } else {
        let f: ModuleNameFn = std::mem::transmute(name_sym);
        let p = f();
        if p.is_null() {
            String::new()
        } else {
            let mut len = 0usize;
            while *p.add(len) != 0 {
                len += 1;
            }
            String::from_utf8_lossy(std::slice::from_raw_parts(p, len)).to_string()
        }
    };

    Ok(LoadedModule { main, name })
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{build_loaded, LoadedModule};
    use std::ptr;

    extern "system" {
        fn CreateFileW(
            name: *const u16,
            access: u32,
            share: u32,
            security: *mut u8,
            disposition: u32,
            flags: u32,
            template: *mut u8,
        ) -> *mut u8;
        fn WriteFile(
            file: *mut u8,
            buffer: *const u8,
            size: u32,
            written: *mut u32,
            overlapped: *mut u8,
        ) -> i32;
        fn GetTempPathW(buffer_len: u32, buffer: *mut u16) -> u32;
        fn LoadLibraryW(name: *const u16) -> *mut u8;
        fn GetProcAddress(module: *mut u8, name: *const u8) -> *mut u8;
        fn DeleteFileW(name: *const u16) -> i32;
        fn CloseHandle(handle: *mut u8) -> i32;
        fn GetLastError() -> u32;
    }

    const INVALID_HANDLE: *mut u8 = -1isize as *mut u8;
    const GENERIC_WRITE: u32 = 0x40000000;
    const CREATE_ALWAYS: u32 = 2;
    const FILE_ATTRIBUTE_TEMPORARY: u32 = 0x100;
    const FILE_FLAG_SEQUENTIAL_SCAN: u32 = 0x08000000;

    pub unsafe fn load(bytes: &[u8], export: &str) -> Result<LoadedModule, String> {
        if bytes.len() < 64 || bytes[0] != 0x4D || bytes[1] != 0x5A {
            return Err("not a valid PE image".into());
        }

        let mut temp_path = [0u16; 260];
        let len = GetTempPathW(260, temp_path.as_mut_ptr());
        if len == 0 {
            return Err("GetTempPathW failed".into());
        }

        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let file_name = format!(
            "{}{:x}{:x}.dll",
            String::from_utf16_lossy(&temp_path[..len as usize]),
            std::process::id(),
            ts.as_millis() as u64
        );
        let wide_path: Vec<u16> = file_name.encode_utf16().chain(std::iter::once(0)).collect();

        let h_file = CreateFileW(
            wide_path.as_ptr(),
            GENERIC_WRITE,
            0,
            ptr::null_mut(),
            CREATE_ALWAYS,
            FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_SEQUENTIAL_SCAN,
            ptr::null_mut(),
        );
        if h_file == INVALID_HANDLE {
            return Err(format!("CreateFileW failed ({})", GetLastError()));
        }

        let mut written = 0u32;
        let ok = WriteFile(
            h_file,
            bytes.as_ptr(),
            bytes.len() as u32,
            &mut written,
            ptr::null_mut(),
        );
        CloseHandle(h_file);
        if ok == 0 || written != bytes.len() as u32 {
            DeleteFileW(wide_path.as_ptr());
            return Err("WriteFile failed".into());
        }

        let h_module = LoadLibraryW(wide_path.as_ptr());
        DeleteFileW(wide_path.as_ptr());

        if h_module.is_null() {
            return Err(format!("LoadLibraryW failed ({})", GetLastError()));
        }

        let main_c = format!("{}\0", export);
        let name_c = "module_name\0".to_string();
        build_loaded(
            GetProcAddress(h_module, main_c.as_ptr()),
            GetProcAddress(h_module, name_c.as_ptr()),
            export,
        )
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{build_loaded, LoadedModule};
    use std::ffi::CStr;

    pub unsafe fn load(bytes: &[u8], export: &str) -> Result<LoadedModule, String> {
        let fd = libc::memfd_create(
            b"libra\0".as_ptr() as *const libc::c_char,
            libc::MFD_CLOEXEC,
        );
        if fd < 0 {
            return Err("memfd_create failed".into());
        }

        let mut written = 0usize;
        while written < bytes.len() {
            let n = libc::write(
                fd,
                bytes[written..].as_ptr() as *const libc::c_void,
                bytes.len() - written,
            );
            if n < 0 {
                libc::close(fd);
                return Err("write to memfd failed".into());
            }
            written += n as usize;
        }

        let path = format!("/proc/self/fd/{}\0", fd);
        let handle = libc::dlopen(path.as_ptr() as *const libc::c_char, libc::RTLD_NOW);
        libc::close(fd);

        if handle.is_null() {
            let err = libc::dlerror();
            let msg = if err.is_null() {
                "unknown".to_string()
            } else {
                CStr::from_ptr(err).to_string_lossy().to_string()
            };
            return Err(format!("dlopen failed: {}", msg));
        }

        let main_c = format!("{}\0", export);
        let name_c = "module_name\0".to_string();
        build_loaded(
            libc::dlsym(handle, main_c.as_ptr() as *const libc::c_char) as *mut u8,
            libc::dlsym(handle, name_c.as_ptr() as *const libc::c_char) as *mut u8,
            export,
        )
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{build_loaded, LoadedModule};
    use std::ffi::CStr;

    pub unsafe fn load(bytes: &[u8], export: &str) -> Result<LoadedModule, String> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let tmp =
            std::env::temp_dir().join(format!("libra_mod_{}_{}.dylib", std::process::id(), nanos));

        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        let path_c =
            std::ffi::CString::new(tmp.to_str().unwrap_or_default()).map_err(|e| e.to_string())?;

        let handle = libc::dlopen(path_c.as_ptr(), libc::RTLD_NOW);
        let _ = std::fs::remove_file(&tmp);

        if handle.is_null() {
            let err = libc::dlerror();
            let msg = if err.is_null() {
                "unknown".to_string()
            } else {
                CStr::from_ptr(err).to_string_lossy().to_string()
            };
            return Err(format!("dlopen failed: {}", msg));
        }

        let main_c = format!("{}\0", export);
        let name_c = "module_name\0".to_string();
        build_loaded(
            libc::dlsym(handle, main_c.as_ptr() as *const libc::c_char) as *mut u8,
            libc::dlsym(handle, name_c.as_ptr() as *const libc::c_char) as *mut u8,
            export,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_empty_bytes_fails() {
        assert!(load_module(&[], "module_main").is_err());
    }

    #[test]
    fn load_invalid_image_fails() {
        let garbage = vec![0x00u8; 128];
        // On Linux this would attempt memfd+dlopen and fail with a dlopen error;
        // on Windows the PE check fails. Either way it must be an error, never a panic.
        assert!(load_module(&garbage, "module_main").is_err());
    }
}
