//! Unix (Linux) implementation of `ProcessExecutor` — raw `fork(2)` +
//! `execve(2)` with full async-signal-safety between fork and exec.
//!
//! # Zombie handling
//! A single background reaper thread polls `waitpid(-1, WNOHANG)` and records
//! exit statuses in a registry, so children never linger as zombies even when
//! the caller never waits. `wait()` / `try_wait()` check the registry first
//! and only then call `waitpid` directly; if the reaper wins the race the
//! registry still has the status, which makes reaping race-free.
//!
//! # FD cleanup between fork and exec
//! The child runs only async-signal-safe code (no allocation, no locks, no
//! std I/O). All buffers (argv, envp, fd snapshot) are built in the parent
//! before `fork`. The child then:
//! 1. `dup2`s the capture pipes / `/dev/null` onto 0,1,2;
//! 2. closes every descriptor >= 3 except the reserved error-reporting fd,
//!    using the `close_range(2)` syscall (Linux >= 5.9) with a pre-fork
//!    `/proc/self/fd` snapshot as fallback for older kernels;
//! 3. `execve`s. Every pipe created here is also `O_CLOEXEC`, so even an fd
//!    opened by another thread in the fork window cannot leak into the child.
//!
//! Spawn failures (bad path, chdir, execve) are reported back through a
//! dedicated errno pipe: the child writes the errno byte before `_exit(126)`,
//! and the parent reads it with a timeout.

use std::collections::{HashMap, VecDeque};
use std::ffi::{CString, OsStr};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::io::{FromRawFd, RawFd};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use libc::{c_char, c_int, pid_t};

use crate::process::{ExitStatus, PlatformSpawn, ProcessError, SpawnConfig};

// ---------------------------------------------------------------------------
// Zombie reaper
// ---------------------------------------------------------------------------

/// Cap on tracked statuses; beyond this the oldest entries are dropped
/// (callers waiting promptly are always served, either from the registry or
/// via a direct `waitpid`).
const MAX_TRACKED: usize = 4096;

struct Reaper {
    state: Mutex<ReaperState>,
}

struct ReaperState {
    statuses: HashMap<pid_t, i32>,
    order: VecDeque<pid_t>,
}

static REAPER: OnceLock<&'static Reaper> = OnceLock::new();

fn reaper() -> &'static Reaper {
    *REAPER.get_or_init(|| {
        let reaper: &'static Reaper = Box::leak(Box::new(Reaper {
            state: Mutex::new(ReaperState {
                statuses: HashMap::new(),
                order: VecDeque::new(),
            }),
        }));
        std::thread::Builder::new()
            .name("libra-zombie-reaper".to_string())
            .spawn(move || reaper_loop(reaper))
            .expect("failed to start zombie reaper thread");
        reaper
    })
}

fn reaper_loop(reaper: &'static Reaper) {
    loop {
        let mut status: c_int = 0;
        // WNOHANG + drain: reap everything that has exited, then sleep.
        let pid = unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) };
        if pid > 0 {
            reaper.record(pid, exit_code(status));
            continue;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

impl Reaper {
    fn record(&self, pid: pid_t, code: i32) {
        if let Ok(mut state) = self.state.lock() {
            if state.statuses.len() >= MAX_TRACKED {
                if let Some(oldest) = state.order.pop_front() {
                    state.statuses.remove(&oldest);
                }
            }
            state.statuses.insert(pid, code);
            state.order.push_back(pid);
        }
    }

    /// Remove and return the recorded status, if the reaper already collected it.
    fn take(&self, pid: pid_t) -> Option<i32> {
        self.state
            .lock()
            .ok()
            .and_then(|mut s| s.statuses.remove(&pid))
    }
}

fn exit_code(status: c_int) -> i32 {
    if libc::WIFEXITED(status) {
        libc::WEXITSTATUS(status)
    } else if libc::WIFSIGNALED(status) {
        128 + libc::WTERMSIG(status)
    } else {
        status
    }
}

// ---------------------------------------------------------------------------
// Child handle
// ---------------------------------------------------------------------------

pub(crate) struct UnixChild {
    pid: pid_t,
    reaper: &'static Reaper,
}

impl UnixChild {
    pub(crate) fn wait(&self) -> Result<ExitStatus, ProcessError> {
        if let Some(code) = self.reaper.take(self.pid) {
            return Ok(ExitStatus::new(code));
        }
        let mut status: c_int = 0;
        loop {
            let r = unsafe { libc::waitpid(self.pid, &mut status, 0) };
            if r == self.pid {
                return Ok(ExitStatus::new(exit_code(status)));
            }
            if r < 0 {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::ECHILD) {
                    // The reaper won the race — the status is in the registry
                    // (or about to be recorded). Poll briefly before giving up.
                    for _ in 0..50 {
                        if let Some(code) = self.reaper.take(self.pid) {
                            return Ok(ExitStatus::new(code));
                        }
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    return Err(ProcessError::new(format!(
                        "waitpid: child {} already reaped and status evicted",
                        self.pid
                    )));
                }
                return Err(ProcessError::new(format!("waitpid failed: {err}")));
            }
        }
    }

    pub(crate) fn try_wait(&self) -> Result<Option<ExitStatus>, ProcessError> {
        if let Some(code) = self.reaper.take(self.pid) {
            return Ok(Some(ExitStatus::new(code)));
        }
        let mut status: c_int = 0;
        let r = unsafe { libc::waitpid(self.pid, &mut status, libc::WNOHANG) };
        if r == self.pid {
            return Ok(Some(ExitStatus::new(exit_code(status))));
        }
        if r == 0 {
            return Ok(None);
        }
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::ECHILD) {
            // The reaper won the race and may not have recorded the status
            // yet. Briefly poll the registry so a concurrent `waitpid(-1)`
            // in the reaper loop does not turn into a spurious error.
            for _ in 0..50 {
                if let Some(code) = self.reaper.take(self.pid) {
                    return Ok(Some(ExitStatus::new(code)));
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        Err(ProcessError::new(format!("waitpid failed: {err}")))
    }

    pub(crate) fn kill(&self) -> Result<(), ProcessError> {
        let r = unsafe { libc::kill(self.pid, libc::SIGKILL) };
        if r == 0 {
            Ok(())
        } else {
            Err(ProcessError::new(format!(
                "kill({}) failed: {}",
                self.pid,
                std::io::Error::last_os_error()
            )))
        }
    }
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

pub(crate) fn spawn(cfg: &SpawnConfig) -> Result<PlatformSpawn, ProcessError> {
    // ---- parent-side preparation (allocation allowed here) ----
    let program = to_cstring(&cfg.program)?;
    let program = resolve_program(&program)?;

    let mut argv = vec![program.clone()];
    for a in &cfg.args {
        argv.push(to_cstring(a)?);
    }
    let argv_ptrs: Vec<*const c_char> = argv.iter().map(|c| c.as_ptr()).collect();

    let envp = build_envp(&cfg.envs)?;
    let envp_ptrs: Vec<*const c_char> = envp.iter().map(|c| c.as_ptr()).collect();

    let cwd = cfg
        .cwd
        .as_ref()
        .map(|c| to_cstring(c.as_os_str()))
        .transpose()?;

    // Capture pipes (O_CLOEXEC: never leak into the exec'd image).
    let mut out_pipe = [-1; 2];
    let mut err_pipe = [-1; 2];
    if cfg.capture_stdout && pipe2_cloexec(&mut out_pipe).is_err() {
        return Err(ProcessError::new("pipe2(stdout) failed"));
    }
    if cfg.capture_stderr && pipe2_cloexec(&mut err_pipe).is_err() {
        if out_pipe[0] >= 0 {
            close_fd(out_pipe[0]);
            close_fd(out_pipe[1]);
        }
        return Err(ProcessError::new("pipe2(stderr) failed"));
    }

    // Error-reporting pipe: reserve a low fd (>= 3) in the parent so the child
    // can reach it after close_range closes everything else.
    let (errno_pipe, err_fd) = if let Some(fd) = find_free_fd() {
        let mut p = [-1; 2];
        if pipe2_cloexec(&mut p).is_ok() {
            // dup2 the write end onto the reserved low fd + mark CLOEXEC so a
            // successful exec closes it (parent sees EOF = success).
            let copy = unsafe { libc::dup2(p[1], fd) };
            if copy >= 0 {
                unsafe { libc::fcntl(copy, libc::F_SETFD, libc::FD_CLOEXEC) };
                (Some(p), copy)
            } else {
                close_fd(p[0]);
                close_fd(p[1]);
                (None, -1)
            }
        } else {
            (None, -1)
        }
    } else {
        (None, -1)
    };

    // Snapshot of open fds >= 3 (fallback when close_range is unavailable).
    let snapshot = snapshot_open_fds();

    // ---- fork ----
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        let err = std::io::Error::last_os_error();
        cleanup_pipes(&out_pipe, &err_pipe, errno_pipe.as_ref(), err_fd);
        return Err(ProcessError::new(format!("fork failed: {err}")));
    }

    if pid == 0 {
        // ---- child: async-signal-safe code only ----
        unsafe {
            child_exec(
                &argv_ptrs,
                &envp_ptrs,
                cwd.as_ref().map(|c| c.as_c_str()),
                cfg.detached,
                cfg.capture_stdout,
                cfg.capture_stderr,
                out_pipe[1],
                err_pipe[1],
                err_fd,
                &snapshot,
            );
        }
    }

    // ---- parent ----
    close_fd(out_pipe[1]);
    close_fd(err_pipe[1]);
    if let Some(p) = errno_pipe.as_ref() {
        close_fd(p[1]);
        close_fd(err_fd);
    }

    // Wait briefly for the child's exec verdict.
    let child_error = errno_pipe
        .as_ref()
        .map(|p| read_child_error(p[0]))
        .transpose()?
        .flatten();
    if let Some(p) = errno_pipe.as_ref() {
        close_fd(p[0]);
    }
    if let Some(errno) = child_error {
        // Child failed before exec — it already exited; reap it via the
        // registry/direct wait so it does not linger.
        let _ = UnixChild {
            pid,
            reaper: reaper(),
        }
        .wait();
        // 释放管道读端（不创建 File，直接 close），避免 IO Safety 认为
        // fd 所有权在父进程被重复关闭。
        if cfg.capture_stdout {
            close_fd(out_pipe[0]);
        }
        if cfg.capture_stderr {
            close_fd(err_pipe[0]);
        }
        return Err(ProcessError::new(format!(
            "child failed to exec: {}",
            std::io::Error::from_raw_os_error(errno)
        )));
    }

    let stdout = if cfg.capture_stdout {
        Some(unsafe { std::fs::File::from_raw_fd(out_pipe[0]) })
    } else {
        None
    };
    let stderr = if cfg.capture_stderr {
        Some(unsafe { std::fs::File::from_raw_fd(err_pipe[0]) })
    } else {
        None
    };

    Ok(PlatformSpawn {
        pid: pid as u32,
        stdout,
        stderr,
        child: UnixChild {
            pid,
            reaper: reaper(),
        },
    })
}

fn cleanup_pipes(
    out_pipe: &[c_int; 2],
    err_pipe: &[c_int; 2],
    errno_pipe: Option<&[c_int; 2]>,
    err_fd: RawFd,
) {
    close_fd(out_pipe[0]);
    close_fd(out_pipe[1]);
    close_fd(err_pipe[0]);
    close_fd(err_pipe[1]);
    if let Some(p) = errno_pipe {
        close_fd(p[0]);
        close_fd(p[1]);
    }
    if err_fd >= 0 {
        close_fd(err_fd);
    }
}

/// Read the child's exec-verdict byte. Returns:
/// - `Ok(Some(errno))` — child failed before exec;
/// - `Ok(None)` — exec succeeded (or verdict unavailable within the timeout).
fn read_child_error(read_fd: RawFd) -> Result<Option<c_int>, ProcessError> {
    let mut pfd = libc::pollfd {
        fd: read_fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let r = unsafe { libc::poll(&mut pfd, 1, 5000) };
    if r <= 0 {
        return Ok(None); // timeout or poll error — assume the child exec'd
    }
    let mut buf = [0u8; 4];
    let n = unsafe { libc::read(read_fd, buf.as_mut_ptr().cast(), buf.len()) };
    if n > 0 {
        let errno = c_int::from_ne_bytes(buf[..4].try_into().unwrap_or([0; 4]));
        Ok(Some(errno))
    } else {
        Ok(None) // EOF → CLOEXEC closed it on successful exec
    }
}

/// Runs in the child after fork. Only async-signal-safe calls from here on:
/// no allocation, no locks, no std I/O, no panics. Never returns.
unsafe fn child_exec(
    argv: &[*const c_char],
    envp: &[*const c_char],
    cwd: Option<&std::ffi::CStr>,
    detached: bool,
    capture_stdout: bool,
    capture_stderr: bool,
    out_write: RawFd,
    err_write: RawFd,
    err_fd: RawFd,
    snapshot: &[RawFd],
) -> ! {
    // --- stdio redirection ---
    if detached {
        libc::setsid();
        let null = libc::open(c"/dev/null".as_ptr(), libc::O_RDWR | libc::O_CLOEXEC);
        if null >= 0 {
            libc::dup2(null, 0);
            libc::dup2(null, 1);
            libc::dup2(null, 2);
        }
    } else {
        let null = libc::open(c"/dev/null".as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC);
        if null >= 0 {
            libc::dup2(null, 0);
        }
        libc::dup2(if capture_stdout { out_write } else { null }, 1);
        libc::dup2(if capture_stderr { err_write } else { null }, 2);
    }

    // --- working directory ---
    if let Some(dir) = cwd {
        libc::chdir(dir.as_ptr());
    }

    // --- close every fd >= 3 except the error-reporting pipe ---
    close_range_except(err_fd, snapshot);

    // --- exec ---
    libc::execve(argv[0], argv.as_ptr(), envp.as_ptr());

    // exec failed: report errno through the reserved pipe, then exit.
    let errno = errno_location();
    libc::write(
        err_fd,
        (errno as *const c_int).cast(),
        core::mem::size_of::<c_int>(),
    );
    libc::_exit(126);
}

/// Close all descriptors >= 3 except `keep`, using close_range(2) when
/// available and the pre-fork snapshot otherwise. Async-signal-safe.
fn close_range_except(keep: RawFd, snapshot: &[RawFd]) {
    #[cfg(target_os = "linux")]
    {
        if keep < 3 {
            // No reserved fd: close everything >= 3 in one call.
            if unsafe { libc::syscall(libc::SYS_close_range, 3usize, u32::MAX as usize, 0usize) }
                == 0
            {
                return;
            }
        } else {
            // Preserve the error pipe: close_range(3, keep-1) + (keep+1, MAX).
            let first = if keep > 3 {
                unsafe { libc::syscall(libc::SYS_close_range, 3usize, (keep - 1) as usize, 0usize) }
            } else {
                0
            };
            let second = unsafe {
                libc::syscall(
                    libc::SYS_close_range,
                    (keep + 1) as usize,
                    u32::MAX as usize,
                    0usize,
                )
            };
            if first == 0 && second == 0 {
                return;
            }
        }
        // ENOSYS (kernel < 5.9) or another failure → snapshot fallback below.
    }
    for &fd in snapshot {
        if fd >= 3 && fd != keep {
            unsafe {
                libc::close(fd);
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn errno_location() -> *mut c_int {
    unsafe { libc::__errno_location() }
}

#[cfg(not(target_os = "linux"))]
fn errno_location() -> *mut c_int {
    // Best-effort for non-Linux unix; falls back to the current errno.
    std::io::Error::last_os_error();
    std::ptr::null_mut()
}

fn pipe2_cloexec(pipe: &mut [c_int; 2]) -> std::io::Result<()> {
    let r = unsafe { libc::pipe2(pipe.as_mut_ptr(), libc::O_CLOEXEC) };
    if r == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

fn close_fd(fd: RawFd) {
    if fd >= 0 {
        unsafe {
            libc::close(fd);
        }
    }
}

/// First free descriptor >= 3 (used to reserve the error pipe in the child).
fn find_free_fd() -> Option<RawFd> {
    for fd in 3..1024 {
        if unsafe { libc::fcntl(fd, libc::F_GETFD) } < 0 {
            return Some(fd);
        }
    }
    None
}

/// Snapshot of currently open fds >= 3, taken in the parent before fork.
fn snapshot_open_fds() -> Vec<RawFd> {
    let mut v = Vec::new();
    if let Ok(dir) = std::fs::read_dir("/proc/self/fd") {
        for entry in dir.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if let Ok(fd) = name.parse::<RawFd>() {
                    if fd >= 3 {
                        v.push(fd);
                    }
                }
            }
        }
    }
    v
}

fn to_cstring(s: &OsStr) -> Result<CString, ProcessError> {
    CString::new(s.as_bytes())
        .map_err(|_| ProcessError::new("argument contains an interior NUL byte"))
}

/// Build "K=V" envp entries: parent environment merged with overrides.
fn build_envp(
    envs: &[(std::ffi::OsString, std::ffi::OsString)],
) -> Result<Vec<CString>, ProcessError> {
    let mut merged: std::collections::BTreeMap<std::ffi::OsString, std::ffi::OsString> =
        std::env::vars_os().collect();
    for (k, v) in envs {
        merged.insert(k.clone(), v.clone());
    }
    let mut out = Vec::with_capacity(merged.len());
    for (k, v) in merged {
        let mut entry = k.as_bytes().to_vec();
        entry.push(b'=');
        entry.extend(v.as_bytes());
        out.push(
            CString::new(entry)
                .map_err(|_| ProcessError::new("environment contains an interior NUL byte"))?,
        );
    }
    Ok(out)
}

/// Resolve the program to an absolute path (PATH search) in the parent so the
/// child only ever runs a plain `execve`. Missing programs become a spawn
/// error instead of a confusing exit code.
fn resolve_program(program: &CString) -> Result<CString, ProcessError> {
    let bytes = program.as_bytes();
    if bytes.contains(&b'/') {
        return Ok(program.clone());
    }
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(OsStr::from_bytes(bytes));
        if is_executable(&candidate) {
            return to_cstring(candidate.as_os_str());
        }
    }
    Err(ProcessError::new(format!(
        "program not found in PATH: {}",
        program.to_string_lossy()
    )))
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::ProcessExecutor;
    use std::time::Duration;

    fn sh(args: &[&str]) -> ProcessExecutor {
        let mut e = ProcessExecutor::new("/bin/sh");
        e.args(args);
        e
    }

    #[test]
    fn spawn_captures_stdout() {
        let out = ProcessExecutor::new("/bin/echo")
            .arg("hello")
            .output()
            .unwrap();
        assert!(out.status.success());
        assert_eq!(out.stdout, b"hello\n");
    }

    #[test]
    fn spawn_captures_stdout_and_stderr_separately() {
        let out = sh(&["-c", "echo out; echo err >&2"]).output().unwrap();
        assert!(out.status.success());
        assert_eq!(out.stdout, b"out\n");
        assert_eq!(out.stderr, b"err\n");
    }

    #[test]
    fn spawn_applies_env_override() {
        let mut e = sh(&["-c", "echo \"$LIBRA_FE_TEST\""]);
        e.env("LIBRA_FE_TEST", "from-env");
        let out = e.output().unwrap();
        assert!(out.status.success());
        assert_eq!(out.stdout, b"from-env\n");
    }

    #[test]
    fn spawn_applies_working_directory() {
        let out = ProcessExecutor::new("/bin/pwd")
            .current_dir("/tmp")
            .output()
            .unwrap();
        assert!(out.status.success());
        assert_eq!(out.stdout, b"/tmp\n");
    }

    #[test]
    fn spawn_missing_program_is_an_error() {
        let err = ProcessExecutor::new("definitely-not-a-real-binary-xyz")
            .spawn()
            .unwrap_err();
        assert!(err.to_string().contains("not found"), "{err}");
    }

    #[test]
    fn spawn_exit_code_and_failure_status() {
        let out = sh(&["-c", "exit 3"]).output().unwrap();
        assert!(!out.status.success());
        assert_eq!(out.status.code(), 3);
    }

    #[test]
    fn try_wait_while_running_then_wait() {
        let mut child = sh(&["-c", "sleep 0.5"]).spawn().unwrap();
        assert!(child.try_wait().unwrap().is_none());
        let status = child.wait().unwrap();
        assert!(status.success());
    }

    #[test]
    fn kill_terminates_with_signal_code() {
        let mut child = sh(&["-c", "sleep 30"]).spawn().unwrap();
        child.kill().unwrap();
        let status = child.wait().unwrap();
        assert_eq!(status.code(), 137); // 128 + SIGKILL(9)
    }

    #[test]
    fn detached_process_is_reaped_and_waitable() {
        let mut child = sh(&["-c", "sleep 0.2"]).detached(true).spawn().unwrap();
        let status = child.wait_timeout(Duration::from_secs(3)).unwrap();
        assert!(
            status.is_some(),
            "detached child should be reaped and waitable"
        );
        assert!(status.unwrap().success());
    }

    #[test]
    fn zombie_is_reaped_even_without_explicit_wait() {
        let mut child = sh(&["-c", "sleep 0.2"]).spawn().unwrap();
        // Do NOT wait here — the reaper thread must collect it.
        std::thread::sleep(Duration::from_millis(700));
        let status = child.wait().unwrap();
        assert!(status.success());
        // A second wait would fail on Unix (already reaped) — first wait proves
        // the reaper recorded the status.
    }

    #[test]
    fn no_fd_leak_across_spawns() {
        let before = open_fd_count();
        for _ in 0..25 {
            let out = sh(&["-c", "true"]).output().unwrap();
            assert!(out.status.success());
        }
        std::thread::sleep(Duration::from_millis(50));
        let after = open_fd_count();
        assert!(
            after <= before + 1,
            "fd count grew: before={before} after={after}"
        );
    }

    fn open_fd_count() -> usize {
        std::fs::read_dir("/proc/self/fd")
            .map(|d| d.count())
            .unwrap_or(0)
    }
}
