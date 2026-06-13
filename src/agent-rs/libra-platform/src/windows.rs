use std::pin::Pin;
use std::future::Future;
use tokio::process::Command;
use tokio::sync::watch;
use crate::platform::{IPlatformExecutor, InteractiveShellHandle};

// Windows API for hiding console windows
#[cfg(windows)]
extern "system" {
    fn GetWindowThreadProcessId(hwnd: *mut std::ffi::c_void, lpdwprocessid: *mut u32) -> u32;
    fn ShowWindow(hwnd: *mut std::ffi::c_void, ncmdshow: i32) -> i32;
    fn EnumWindows(lpenumfunc: unsafe extern "system" fn(*mut std::ffi::c_void, isize) -> i32, lparam: isize) -> i32;
}

#[cfg(windows)]
const SW_HIDE: i32 = 0;

#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x00000010;

// Struct for EnumWindows callback to find console window by process ID
#[cfg(windows)]
struct FindWindowCtx {
    target_pid: u32,
    found_hwnd: *mut std::ffi::c_void,
}

#[cfg(windows)]
unsafe extern "system" fn enum_windows_callback(hwnd: *mut std::ffi::c_void, lparam: isize) -> i32 {
    let ctx = &mut *(lparam as *mut FindWindowCtx);
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == ctx.target_pid {
        ctx.found_hwnd = hwnd;
        return 0; // Stop enumeration
    }
    1 // Continue
}

pub struct WindowsExecutor;

impl WindowsExecutor {
    pub fn new() -> Self {
        Self
    }
}

impl IPlatformExecutor for WindowsExecutor {
    fn get_default_shell(&self) -> &str {
        "cmd.exe"
    }

    fn is_available(&self) -> bool {
        cfg!(target_os = "windows")
    }

    fn execute(
        &self,
        command: &str,
    ) -> Pin<Box<dyn Future<Output = String> + Send + '_>> {
        let command = command.to_string();
        Box::pin(async move {
            let output = Command::new("cmd.exe")
                .args(["/c", &command])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                .await;

            match output {
                Ok(out) => {
                    let stdout = crate::decode_shell_bytes(&out.stdout);
                    let stderr = crate::decode_shell_bytes(&out.stderr);
                    if stdout.is_empty() { stderr } else { stdout }
                }
                Err(e) => format!("Failed to start process: {}", e),
            }
        })
    }

    fn start_interactive_shell(&self) -> InteractiveShellHandle {
        use std::process::Stdio;

        let (cancel_tx, _) = watch::channel(false);

        // Use CREATE_NEW_CONSOLE so the shell has a proper console for handling
        // control characters (Ctrl+C, Ctrl+Z, etc.). CREATE_NO_WINDOW prevents
        // console allocation which breaks control character processing.
        let child = Command::new("cmd.exe")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir("C:\\")
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .expect("Failed to start cmd.exe");

        // Hide the console window immediately after spawn
        #[cfg(windows)]
        {
            let pid = child.id().unwrap_or(0);
            if pid > 0 {
                hide_console_window(pid);
            }
        }

        InteractiveShellHandle { child, cancel_tx }
    }

    fn get_drives(&self) -> Vec<String> {
        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            if std::path::Path::new(&path).exists() {
                drives.push(path);
            }
        }
        drives
    }
}

/// Find and hide the console window belonging to the given process ID.
#[cfg(windows)]
fn hide_console_window(pid: u32) {
    unsafe {
        let mut ctx = FindWindowCtx {
            target_pid: pid,
            found_hwnd: std::ptr::null_mut(),
        };
        let ctx_ptr = &mut ctx as *mut FindWindowCtx as isize;
        EnumWindows(enum_windows_callback, ctx_ptr);

        if !ctx.found_hwnd.is_null() {
            ShowWindow(ctx.found_hwnd, SW_HIDE);
        }
    }
}
