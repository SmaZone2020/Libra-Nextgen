//! Windows implementation of `ProcessExecutor` — `CreateProcessW` with pipe
//! redirection, environment block and working-directory support.
//!
//! - Output capture: `CreatePipe` + `SetHandleInformation(HANDLE_FLAG_INHERIT)`
//!   on the write ends; the parent closes its copies right after spawn and
//!   reads from the non-inheritable read ends.
//! - Environment: an explicit `K=V\0...\0\0` UTF-16 block (parent environment
//!   merged with overrides) is passed when any `env()` override exists,
//!   otherwise the child inherits the parent environment (null block).
//! - Detached mode: `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP |
//!   CREATE_NO_WINDOW`, stdio redirected to `NUL`.
//! - There are no zombies on Windows: the process handle simply waits for the
//!   kernel object; `WaitForSingleObject`/`GetExitCodeProcess` implement
//!   wait and try-wait.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{FromRawHandle, RawHandle};

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CloseHandle, SetHandleInformation, GENERIC_READ, GENERIC_WRITE, HANDLE, HANDLE_FLAG_INHERIT,
    INVALID_HANDLE_VALUE, WAIT_TIMEOUT,
};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_CREATION_DISPOSITION, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_MODE,
    FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CreateProcessW, GetExitCodeProcess, TerminateProcess, WaitForSingleObject,
    CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, DETACHED_PROCESS,
    PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
    STARTUPINFOW_FLAGS,
};

use crate::process::{ExitStatus, PlatformSpawn, ProcessError, SpawnConfig};

pub(crate) struct WindowsChild {
    handle: HANDLE,
}

impl WindowsChild {
    pub(crate) fn wait(&self) -> Result<ExitStatus, ProcessError> {
        unsafe { WaitForSingleObject(self.handle, u32::MAX) };
        self.exit_code()
    }

    pub(crate) fn try_wait(&self) -> Result<Option<ExitStatus>, ProcessError> {
        let r = unsafe { WaitForSingleObject(self.handle, 0) };
        if r == WAIT_TIMEOUT {
            return Ok(None);
        }
        Ok(Some(self.exit_code()?))
    }

    pub(crate) fn kill(&self) -> Result<(), ProcessError> {
        unsafe { TerminateProcess(self.handle, 1) }
            .map_err(|e| ProcessError::new(format!("TerminateProcess failed: {e}")))?;
        Ok(())
    }

    fn exit_code(&self) -> Result<ExitStatus, ProcessError> {
        let mut code: u32 = 0;
        unsafe { GetExitCodeProcess(self.handle, &mut code) }
            .map_err(|e| ProcessError::new(format!("GetExitCodeProcess failed: {e}")))?;
        Ok(ExitStatus::new(code as i32))
    }
}

impl Drop for WindowsChild {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

pub(crate) fn spawn(cfg: &SpawnConfig) -> Result<PlatformSpawn, ProcessError> {
    // ---- command line: quoted program + args (CommandLineToArgvW rules) ----
    let mut cmdline: Vec<u16> = quote_arg(&cfg.program);
    for a in &cfg.args {
        cmdline.push(' ' as u16);
        cmdline.extend(quote_arg(a));
    }
    cmdline.push(0);

    // ---- environment block: "K=V\0K=V\0\0" (null → inherit) ----
    let env_block: Option<Vec<u16>> = if cfg.envs.is_empty() {
        None
    } else {
        let mut merged: HashMap<std::ffi::OsString, std::ffi::OsString> =
            std::env::vars_os().collect();
        for (k, v) in &cfg.envs {
            merged.insert(k.clone(), v.clone());
        }
        let mut block = Vec::new();
        for (k, v) in merged {
            // Skip hidden drive-relative entries ("=C:=C:\...") — empty names
            // make CreateProcessW fail with E_INVALIDARG.
            let bytes = k.as_os_str().as_encoded_bytes();
            if bytes.is_empty() || bytes[0] == b'=' {
                continue;
            }
            block.extend(k.encode_wide());
            block.push('=' as u16);
            block.extend(v.encode_wide());
            block.push(0);
        }
        block.push(0);
        Some(block)
    };

    // ---- working directory ----
    let cwd_wide: Option<Vec<u16>> = cfg.cwd.as_ref().map(|c| {
        let mut w: Vec<u16> = c.encode_wide().collect();
        w.push(0);
        w
    });

    // ---- capture pipes (write ends inheritable, read ends not) ----
    let mut out_read = INVALID_HANDLE_VALUE;
    let mut out_write = INVALID_HANDLE_VALUE;
    let mut err_read = INVALID_HANDLE_VALUE;
    let mut err_write = INVALID_HANDLE_VALUE;
    if cfg.capture_stdout {
        create_inheritable_pipe(&mut out_read, &mut out_write)?;
    }
    if cfg.capture_stderr {
        create_inheritable_pipe(&mut err_read, &mut err_write)?;
    }

    // ---- NUL handles for stdio we do not capture ----
    let nul_in = create_nul(GENERIC_READ.0)?;
    let nul_out = create_nul(GENERIC_WRITE.0)?;

    let startup = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        dwFlags: STARTUPINFOW_FLAGS(STARTF_USESTDHANDLES.0),
        hStdInput: nul_in,
        hStdOutput: if cfg.capture_stdout {
            out_write
        } else {
            nul_out
        },
        hStdError: if cfg.capture_stderr {
            err_write
        } else {
            nul_out
        },
        ..Default::default()
    };

    let mut flags = CREATE_NO_WINDOW.0;
    if cfg.detached {
        flags |= DETACHED_PROCESS.0 | CREATE_NEW_PROCESS_GROUP.0;
    }
    // A non-null lpEnvironment is interpreted as ANSI unless
    // CREATE_UNICODE_ENVIRONMENT is set — without it the UTF-16 block is
    // malformed and CreateProcessW fails with ERROR_INVALID_PARAMETER.
    if env_block.is_some() {
        flags |= CREATE_UNICODE_ENVIRONMENT.0;
    }

    let mut pi = PROCESS_INFORMATION::default();
    let hr = unsafe {
        CreateProcessW(
            PCWSTR::null(),
            PWSTR(cmdline.as_mut_ptr()),
            None,
            None,
            true,
            PROCESS_CREATION_FLAGS(flags),
            env_block
                .as_ref()
                .map(|b| b.as_ptr() as *const core::ffi::c_void),
            cwd_wide
                .as_ref()
                .map(|c| PCWSTR(c.as_ptr()))
                .unwrap_or_else(PCWSTR::null),
            &startup,
            &mut pi,
        )
    };
    if hr.is_err() {
        close_handle(out_read);
        close_handle(out_write);
        close_handle(err_read);
        close_handle(err_write);
        close_handle(nul_in);
        close_handle(nul_out);
        return Err(ProcessError::new(format!(
            "CreateProcessW failed: {}",
            hr.unwrap_err()
        )));
    }

    // Parent closes its copies of the inheritable write ends + NUL handles.
    close_handle(out_write);
    close_handle(err_write);
    close_handle(nul_in);
    close_handle(nul_out);
    // The thread handle is not needed.
    unsafe {
        let _ = CloseHandle(pi.hThread);
    }

    let stdout: Option<std::fs::File> = if cfg.capture_stdout {
        Some(unsafe { std::fs::File::from_raw_handle(out_read.0 as RawHandle) })
    } else {
        None
    };
    let stderr: Option<std::fs::File> = if cfg.capture_stderr {
        Some(unsafe { std::fs::File::from_raw_handle(err_read.0 as RawHandle) })
    } else {
        None
    };

    Ok(PlatformSpawn {
        pid: pi.dwProcessId,
        stdout,
        stderr,
        child: WindowsChild {
            handle: pi.hProcess,
        },
    })
}

fn create_inheritable_pipe(read: &mut HANDLE, write: &mut HANDLE) -> Result<(), ProcessError> {
    unsafe { CreatePipe(read, write, None, 0) }
        .map_err(|e| ProcessError::new(format!("CreatePipe failed: {e}")))?;
    unsafe { SetHandleInformation(*write, HANDLE_FLAG_INHERIT.0, HANDLE_FLAG_INHERIT) }
        .map_err(|e| ProcessError::new(format!("SetHandleInformation failed: {e}")))?;
    Ok(())
}

fn create_nul(access: u32) -> Result<HANDLE, ProcessError> {
    let name = PCWSTR(windows::core::w!("NUL").as_ptr());
    let share = FILE_SHARE_MODE(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0);
    let handle = unsafe {
        CreateFileW(
            name,
            access,
            share,
            None,
            FILE_CREATION_DISPOSITION(OPEN_EXISTING.0),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
    }
    .map_err(|e| ProcessError::new(format!("CreateFileW(NUL) failed: {e}")))?;
    // NUL handles are passed to the child via STARTUPINFO, so they must be
    // inheritable — otherwise the child's std handles are invalid values and
    // cmd.exe-style strict programs fail immediately.
    unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT.0, HANDLE_FLAG_INHERIT) }
        .map_err(|e| ProcessError::new(format!("SetHandleInformation(NUL) failed: {e}")))?;
    Ok(handle)
}

fn close_handle(h: HANDLE) {
    if h != INVALID_HANDLE_VALUE {
        unsafe {
            let _ = CloseHandle(h);
        }
    }
}

/// Quote one argument per CommandLineToArgvW rules.
fn quote_arg(arg: &OsStr) -> Vec<u16> {
    let s: Vec<u16> = arg.encode_wide().collect();
    if s.is_empty() {
        return vec!['"' as u16, '"' as u16];
    }
    let needs_quote = s
        .iter()
        .any(|&c| c == ' ' as u16 || c == '\t' as u16 || c == '"' as u16);
    if !needs_quote {
        return s;
    }
    let mut out = Vec::new();
    out.push('"' as u16);
    let mut backslashes = 0usize;
    for &c in &s {
        if c == '\\' as u16 {
            backslashes += 1;
        } else if c == '"' as u16 {
            for _ in 0..backslashes * 2 {
                out.push('\\' as u16);
            }
            backslashes = 0;
            out.push('\\' as u16); // escape the quote
            out.push(c);
        } else {
            for _ in 0..backslashes {
                out.push('\\' as u16);
            }
            backslashes = 0;
            out.push(c);
        }
    }
    for _ in 0..backslashes * 2 {
        out.push('\\' as u16);
    }
    out.push('"' as u16);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::ProcessExecutor;
    use std::time::Duration;

    fn cmd(args: &[&str]) -> ProcessExecutor {
        let mut e = ProcessExecutor::new("cmd");
        e.arg("/C");
        e.args(args);
        e
    }

    #[test]
    fn spawn_captures_stdout() {
        let out = cmd(&["echo", "hello"]).output().unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).contains("hello"));
    }

    #[test]
    fn spawn_applies_env_override() {
        let mut e = cmd(&["echo", "%LIBRA_FE_TEST%"]);
        e.env("LIBRA_FE_TEST", "from-env");
        let out = e.output().unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).contains("from-env"));
    }

    #[test]
    fn spawn_applies_working_directory() {
        let dir = std::env::temp_dir();
        let out = cmd(&["cd"]).current_dir(&dir).output().unwrap();
        assert!(out.status.success());
        let stdout = String::from_utf8_lossy(&out.stdout).to_lowercase();
        let expected = dir.to_string_lossy().to_lowercase();
        assert!(
            stdout.contains(expected.trim_end_matches('\\')),
            "cd -> {stdout}"
        );
    }

    #[test]
    fn spawn_exit_code() {
        let out = cmd(&["exit", "3"]).output().unwrap();
        assert!(!out.status.success());
        assert_eq!(out.status.code(), 3);
    }

    #[test]
    fn try_wait_while_running_then_wait() {
        let mut child = cmd(&["ping", "-n", "2", "127.0.0.1", ">nul"])
            .spawn()
            .unwrap();
        let _ = child.try_wait().unwrap();
        let status = child.wait().unwrap();
        assert!(status.success());
    }

    #[test]
    fn kill_terminates() {
        let mut child = cmd(&["timeout", "/t", "30"]).spawn().unwrap();
        child.kill().unwrap();
        let status = child.wait().unwrap();
        assert_eq!(status.code(), 1); // TerminateProcess exit code
    }

    #[test]
    fn detached_process_is_waitable() {
        let mut child = cmd(&["timeout", "/t", "1", "/nobreak", ">nul"])
            .detached(true)
            .spawn()
            .unwrap();
        let status = child.wait_timeout(Duration::from_secs(5)).unwrap();
        assert!(status.is_some(), "detached child should be waitable");
    }

    #[test]
    fn quote_arg_handles_spaces_and_quotes() {
        assert_eq!(
            quote_arg(OsStr::new("plain")),
            vec![
                b'p' as u16,
                b'l' as u16,
                b'a' as u16,
                b'i' as u16,
                b'n' as u16
            ]
        );
        let quoted = quote_arg(OsStr::new("C:\\Program Files\\x"));
        assert_eq!(quoted[0], '"' as u16);
        assert_eq!(*quoted.last().unwrap(), '"' as u16);
    }
}
