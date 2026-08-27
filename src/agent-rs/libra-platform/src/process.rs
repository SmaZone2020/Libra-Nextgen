//! Cross-platform process execution (fork-and-run) for the Libra agent.
//!
//! `ProcessExecutor` is a unified builder that spawns child processes on both
//! Linux (raw `fork(2)` + `execvp(2)`) and Windows (`CreateProcessW`), with
//! stdout/stderr capture, environment overrides, working directory control and
//! detached (daemon) execution.
//!
//! ```no_run
//! use libra_platform::process::ProcessExecutor;
//!
//! let mut executor = ProcessExecutor::new("ls");
//! executor.arg("-la");
//! executor.env("MY_VAR", "value");
//! executor.detached(true);
//! executor.spawn()?;
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! # Zombie processes
//! Unix children are reaped by a background reaper thread (`waitpid(-1,
//! WNOHANG)` loop) so no zombie accumulates even when the caller never waits.
//! `wait()` / `try_wait()` first consult the reaper's status registry, then
//! fall back to a direct `waitpid`, which makes reaping race-free.
//!
//! # File descriptor hygiene
//! Between `fork` and `exec` the child closes every descriptor >= 3 (via the
//! `close_range(2)` syscall on Linux >= 5.9, with a pre-fork `/proc/self/fd`
//! snapshot fallback), so spawned processes never inherit the agent's sockets,
//! epoll handles or module files. Every pipe created here is `O_CLOEXEC` as a
//! second line of defense. Only async-signal-safe calls run in the child.

use std::ffi::OsString;
use std::io::Read;
use std::time::Duration;

/// Builder for spawning a child process.
#[derive(Debug, Clone, Default)]
pub struct ProcessExecutor {
    program: Option<OsString>,
    args: Vec<OsString>,
    envs: Vec<(OsString, OsString)>,
    cwd: Option<OsString>,
    detached: bool,
    capture_stdout: bool,
    capture_stderr: bool,
}

/// Exit status of a spawned process, normalized across platforms.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExitStatus {
    code: i32,
}

impl Default for ExitStatus {
    fn default() -> Self {
        Self { code: 0 }
    }
}

impl ExitStatus {
    pub fn new(code: i32) -> Self {
        Self { code }
    }

    /// Raw exit code. On Unix this follows shell conventions:
    /// exited(n) → n; killed by signal s → 128 + s. On Windows it is the
    /// process exit code (or the value passed to TerminateProcess).
    pub fn code(&self) -> i32 {
        self.code
    }

    pub fn success(&self) -> bool {
        self.code == 0
    }
}

impl std::fmt::Display for ExitStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "exit code {}", self.code)
    }
}

/// A spawned process: platform handle + optional captured pipe readers.
pub struct SpawnedProcess {
    pub(crate) pid: u32,
    pub(crate) stdout: Option<std::fs::File>,
    pub(crate) stderr: Option<std::fs::File>,
    pub(crate) inner: ChildInner,
}

/// Collected output of a completed process (like `std::process::Output`).
#[derive(Debug, Clone, Default)]
pub struct ProcessOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Errors surfaced by the executor. Spawn errors distinguish "process did not
/// start" (bad path, permission, fork/CreateProcess failure) from wait errors.
#[derive(Debug)]
pub struct ProcessError {
    message: String,
}

impl ProcessError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ProcessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ProcessError {}

#[cfg(unix)]
pub(crate) type ChildInner = crate::process_unix::UnixChild;
#[cfg(windows)]
pub(crate) type ChildInner = crate::process_windows::WindowsChild;

/// Platform-agnostic spawn result.
pub(crate) struct PlatformSpawn {
    pub pid: u32,
    pub stdout: Option<std::fs::File>,
    pub stderr: Option<std::fs::File>,
    pub child: ChildInner,
}

/// Everything a platform spawner needs. Built in `ProcessExecutor::spawn`
/// after all validation, then handed to the platform implementation.
pub(crate) struct SpawnConfig {
    pub program: OsString,
    pub args: Vec<OsString>,
    pub envs: Vec<(OsString, OsString)>,
    pub cwd: Option<OsString>,
    pub detached: bool,
    pub capture_stdout: bool,
    pub capture_stderr: bool,
}

impl ProcessExecutor {
    /// New builder for `program` (a path or, on Unix, a name resolved via
    /// `$PATH`; on Windows via the standard search order). Stdout/stderr
    /// capture is on by default (unless `detached(true)` is set).
    pub fn new(program: impl Into<OsString>) -> Self {
        Self {
            program: Some(program.into()),
            capture_stdout: true,
            capture_stderr: true,
            ..Default::default()
        }
    }

    /// Append a single argument.
    pub fn arg(&mut self, arg: impl Into<OsString>) -> &mut Self {
        self.args.push(arg.into());
        self
    }

    /// Append multiple arguments.
    pub fn args<I, S>(&mut self, args: I) -> &mut Self
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }

    /// Set an environment variable for the child (merged over the parent's
    /// environment). No `env` calls → child inherits the parent environment.
    pub fn env(&mut self, key: impl Into<OsString>, value: impl Into<OsString>) -> &mut Self {
        self.envs.push((key.into(), value.into()));
        self
    }

    /// Set the child's working directory.
    pub fn current_dir(&mut self, dir: impl Into<OsString>) -> &mut Self {
        self.cwd = Some(dir.into());
        self
    }

    /// Detached (daemon) mode: the child gets its own session (Unix `setsid`;
    /// Windows `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`), stdin/stdout/
    /// stderr are redirected to NUL and no output is captured. The process is
    /// still reaped by the zombie reaper and `wait()`/`try_wait()` remain
    /// available.
    pub fn detached(&mut self, detached: bool) -> &mut Self {
        self.detached = detached;
        self
    }

    /// Capture the child's stdout (default: on for non-detached spawns).
    pub fn capture_stdout(&mut self, capture: bool) -> &mut Self {
        self.capture_stdout = capture;
        self
    }

    /// Capture the child's stderr (default: on for non-detached spawns).
    pub fn capture_stderr(&mut self, capture: bool) -> &mut Self {
        self.capture_stderr = capture;
        self
    }

    /// Spawn the child and return a handle. In detached mode no pipes are
    /// created and capture flags are ignored.
    pub fn spawn(&self) -> Result<SpawnedProcess, ProcessError> {
        let program = self
            .program
            .clone()
            .ok_or_else(|| ProcessError::new("program not set"))?;
        if program.is_empty() {
            return Err(ProcessError::new("program is empty"));
        }

        let capture_stdout = !self.detached && self.capture_stdout;
        let capture_stderr = !self.detached && self.capture_stderr;

        let cfg = SpawnConfig {
            program,
            args: self.args.clone(),
            envs: self.envs.clone(),
            cwd: self.cwd.clone(),
            detached: self.detached,
            capture_stdout,
            capture_stderr,
        };

        #[cfg(unix)]
        let spawn = crate::process_unix::spawn(&cfg)?;
        #[cfg(windows)]
        let spawn = crate::process_windows::spawn(&cfg)?;

        Ok(SpawnedProcess {
            pid: spawn.pid,
            stdout: spawn.stdout,
            stderr: spawn.stderr,
            inner: spawn.child,
        })
    }

    /// Spawn, read stdout/stderr to EOF, and wait — the `Command::output`
    /// equivalent. Pipes are drained on worker threads so a chatty child can
    /// never deadlock on a full pipe buffer.
    pub fn output(&self) -> Result<ProcessOutput, ProcessError> {
        let mut child = self.spawn()?;
        // Drain both pipes concurrently: a child blocked writing to a full
        // pipe never exits, and a sequential read would never reach EOF.
        let stdout = child
            .stdout
            .take()
            .map(|r| std::thread::spawn(move || read_to_eof_owned(r)));
        let stderr = child
            .stderr
            .take()
            .map(|r| std::thread::spawn(move || read_to_eof_owned(r)));
        let status = child.wait()?;
        let stdout = stdout.and_then(|h| h.join().ok()).unwrap_or_default();
        let stderr = stderr.and_then(|h| h.join().ok()).unwrap_or_default();
        Ok(ProcessOutput {
            status,
            stdout,
            stderr,
        })
    }
}

fn read_to_eof_owned(mut reader: std::fs::File) -> Vec<u8> {
    let mut buf = Vec::new();
    let _ = reader.read_to_end(&mut buf);
    buf
}

impl SpawnedProcess {
    /// The child's OS process id.
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Read the captured stdout pipe to EOF. Empty when not captured.
    pub fn read_stdout(&mut self) -> Result<Vec<u8>, ProcessError> {
        read_pipe(self.stdout.as_mut())
    }

    /// Read the captured stderr pipe to EOF. Empty when not captured.
    pub fn read_stderr(&mut self) -> Result<Vec<u8>, ProcessError> {
        read_pipe(self.stderr.as_mut())
    }

    /// Access the raw stdout reader.
    pub fn stdout(&mut self) -> Option<&mut std::fs::File> {
        self.stdout.as_mut()
    }

    /// Access the raw stderr reader.
    pub fn stderr(&mut self) -> Option<&mut std::fs::File> {
        self.stderr.as_mut()
    }

    /// Take ownership of the stdout pipe (for draining on another thread).
    pub fn take_stdout(&mut self) -> Option<std::fs::File> {
        self.stdout.take()
    }

    /// Take ownership of the stderr pipe (for draining on another thread).
    pub fn take_stderr(&mut self) -> Option<std::fs::File> {
        self.stderr.take()
    }

    /// Block until the child exits and return its status. Safe to call from a
    /// blocking context (module tasks run on the blocking pool).
    pub fn wait(&mut self) -> Result<ExitStatus, ProcessError> {
        self.inner.wait()
    }

    /// Non-blocking status check. `Ok(None)` while the child still runs.
    pub fn try_wait(&mut self) -> Result<Option<ExitStatus>, ProcessError> {
        self.inner.try_wait()
    }

    /// Wait up to `timeout`; `Ok(None)` if the child is still running.
    pub fn wait_timeout(&mut self, timeout: Duration) -> Result<Option<ExitStatus>, ProcessError> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if let Some(status) = self.try_wait()? {
                return Ok(Some(status));
            }
            if std::time::Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Terminate the child (SIGKILL on Unix, TerminateProcess on Windows).
    pub fn kill(&mut self) -> Result<(), ProcessError> {
        self.inner.kill()
    }
}

fn read_pipe(reader: Option<&mut std::fs::File>) -> Result<Vec<u8>, ProcessError> {
    match reader {
        Some(r) => {
            let mut buf = Vec::new();
            r.read_to_end(&mut buf)
                .map_err(|e| ProcessError::new(format!("read pipe failed: {e}")))?;
            Ok(buf)
        }
        None => Ok(Vec::new()),
    }
}

impl std::fmt::Debug for SpawnedProcess {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SpawnedProcess")
            .field("pid", &self.pid)
            .finish()
    }
}

impl Drop for SpawnedProcess {
    fn drop(&mut self) {
        // Dropping a still-running child does NOT kill it (matches
        // std::process::Child). Pipes are closed here; the zombie reaper
        // eventually collects the exit status.
    }
}
