use std::collections::HashMap;

use libra_comm::http::HttpCommunicator;
use libra_load::{load_module, LoadedModule, ModuleMainFn};

const MODULE_OUTPUT_CAP: usize = 16 * 1024 * 1024; // 16 MB per module result

/// Cloud module loader — downloads, loads in memory, and invokes modules on
/// demand. Only the modules actually used by a session are ever downloaded.
pub struct ModuleManager {
    http: HttpCommunicator,
    agent_id: String,
    session_key: Option<[u8; 32]>,
    loaded: HashMap<String, LoadedModule>,
}

impl ModuleManager {
    pub fn new(
        server_url: &str,
        register_path: &str,
        heartbeat_path: &str,
        result_path: &str,
        agent_id: String,
        session_key: Option<[u8; 32]>,
        session_token: Option<String>,
    ) -> Self {
        let mut http =
            HttpCommunicator::new(server_url, register_path, heartbeat_path, result_path);
        if let Some(t) = session_token {
            http.set_session_token(t);
        }
        Self {
            http,
            agent_id,
            session_key,
            loaded: HashMap::new(),
        }
    }

    pub fn is_loaded(&self, name: &str) -> bool {
        self.loaded.contains_key(name)
    }

    /// Download and in-memory load a module if not already loaded.
    async fn ensure_loaded(&mut self, name: &str) -> Result<(), String> {
        if self.loaded.contains_key(name) {
            return Ok(());
        }
        let key = self
            .session_key
            .as_ref()
            .ok_or("no session key — cannot download modules")?;

        let bytes = self.http.download_module(name, &self.agent_id, key).await?;
        let module = load_module(&bytes, "module_main")?;

        // Self-identification check: the downloaded artifact must claim to be
        // the requested module. 空名（模块未导出 module_name）视为不匹配——
        // 之前空名会静默放行，把任意 .so 伪装成目标模块执行。
        if module.name.is_empty() {
            libra_common::dlog!(
                "[module] '{name}' artifact has no module_name export — refusing to load"
            );
            return Err(format!(
                "module content invalid: '{name}' artifact missing module_name export"
            ));
        }
        if module.name != name {
            libra_common::dlog!(
                "[module] MISMATCH: requested '{name}', downloaded '{0}'",
                module.name
            );
            return Err(format!(
                "module content mismatch: requested '{name}', downloaded '{}'",
                module.name
            ));
        }

        self.loaded.insert(name.to_string(), module);
        Ok(())
    }

    /// Invoke a module by name with a JSON input, returning its JSON output.
    pub async fn run(&mut self, name: &str, input: &str) -> Result<String, String> {
        let (main, input) = self.prepare(name, input).await?;
        execute_module(main, &input).await
    }

    /// Download/load a module and resolve its entry point, returning the entry
    /// plus the owned input. The caller must NOT hold `&mut self` (or the
    /// module manager lock) while executing, so concurrent tasks can run
    /// different modules in parallel instead of serializing on the loader.
    pub async fn prepare(
        &mut self,
        name: &str,
        input: &str,
    ) -> Result<(ModuleMainFn, String), String> {
        self.ensure_loaded(name).await?;
        let main = self
            .loaded
            .get(name)
            .map(|m| m.main)
            .ok_or("module not loaded")?;
        Ok((main, input.to_string()))
    }
}

/// Execute a resolved module entry point on the blocking pool. No module
/// manager lock is held here, so independent tasks run their modules in
/// parallel.
pub async fn execute_module(main: ModuleMainFn, input: &str) -> Result<String, String> {
    let input = input.to_string();
    tokio::task::spawn_blocking(move || {
        let mut out = vec![0u8; MODULE_OUTPUT_CAP];
        let written = unsafe { main(input.as_ptr(), input.len(), out.as_mut_ptr(), out.len()) };
        if written > out.len() {
            return Err("module output exceeded capacity".to_string());
        }
        String::from_utf8(out[..written].to_vec())
            .map_err(|e| format!("module returned invalid UTF-8: {}", e))
    })
    .await
    .map_err(|e| format!("module task panicked: {}", e))?
}

/// Execute a module entry **in a forked child process** so that a crashing or
/// aborting module (segfault, panic=abort, bad FFI) cannot take the agent
/// down — the agent process itself stays untouched and keeps its session.
///
/// The module runs with a copy-on-write snapshot of the agent's memory, so
/// in-memory loaded modules work without any disk artifact. Only the module
/// entry runs in the child (synchronous FFI — modules must not touch the
/// tokio runtime or shared cross-thread state), and its JSON output is piped
/// back. A crash is reported as an error with the wait status instead of
/// killing the agent.
///
/// Windows has no fork(2): the module falls back to in-process execution
/// (isolation is Linux-first by design).
pub async fn execute_module_isolated(main: ModuleMainFn, input: &str) -> Result<String, String> {
    #[cfg(unix)]
    {
        execute_module_isolated_unix(main, input).await
    }
    #[cfg(not(unix))]
    {
        libra_common::dlog!(
            "[module] isolated execution unavailable on this platform — running in-process"
        );
        execute_module(main, input).await
    }
}

/// fork(2)-based isolated execution. The child runs only the module entry and
/// async-signal-safe code; buffers are allocated in the parent before fork.
#[cfg(unix)]
async fn execute_module_isolated_unix(main: ModuleMainFn, input: &str) -> Result<String, String> {
    use std::io::Read;
    use std::os::unix::io::FromRawFd;

    // All buffers must exist before fork: the child never allocates.
    let input_owned = input.to_string();
    let mut out = vec![0u8; MODULE_OUTPUT_CAP];

    // Result pipe (write end used by the child, read end by the parent).
    let mut pipe = [-1 as libc::c_int; 2];
    if unsafe { libc::pipe2(pipe.as_mut_ptr(), libc::O_CLOEXEC) } != 0 {
        return Err(format!("pipe2 failed: {}", std::io::Error::last_os_error()));
    }

    let pid = unsafe { libc::fork() };
    if pid < 0 {
        unsafe {
            libc::close(pipe[0]);
            libc::close(pipe[1]);
        }
        return Err(format!("fork failed: {}", std::io::Error::last_os_error()));
    }

    if pid == 0 {
        // ── child: only async-signal-safe calls ──
        // Run the module, write its output to the pipe, then exit. A crash
        // (SIGSEGV/SIGABRT) kills the child before the write; the parent sees
        // EOF plus a non-zero wait status.
        unsafe {
            libc::close(pipe[0]);
            let written = main(
                input_owned.as_ptr(),
                input_owned.len(),
                out.as_mut_ptr(),
                out.len(),
            );
            let n = written.min(out.len());
            if n > 0 {
                let _ = libc::write(pipe[1], out.as_ptr().cast(), n);
            }
            libc::_exit(0);
        }
    }

    // ── parent ──
    unsafe {
        libc::close(pipe[1]);
    }

    let mut read_fd = unsafe { std::fs::File::from_raw_fd(pipe[0]) };
    let mut result = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match read_fd.read(&mut buf) {
            Ok(0) => break, // EOF: module wrote output and exited (or crashed)
            Ok(n) => result.extend_from_slice(&buf[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => {
                // Abnormal pipe failure — kill the child so it cannot linger.
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                }
                let _ = reap_child(pid);
                return Err(format!("read child pipe failed: {e}"));
            }
        }
    }

    let status = reap_child(pid);
    if status != 0 {
        return Err(format!(
            "module crashed in isolated child ({})",
            describe_wait_status(status)
        ));
    }

    String::from_utf8(result).map_err(|e| format!("module returned invalid UTF-8: {e}"))
}

/// Block until `pid` exits; returns the raw wait status (0 = exited cleanly).
#[cfg(unix)]
fn reap_child(pid: libc::pid_t) -> libc::c_int {
    let mut status: libc::c_int = 0;
    loop {
        let r = unsafe { libc::waitpid(pid, &mut status, 0) };
        if r == pid {
            return status;
        }
        if r < 0 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            return -1; // ECHILD etc. — treat as unknown
        }
    }
}

/// Human-readable wait status: "exit code 3" / "signal 6 (SIGABRT)".
#[cfg(unix)]
fn describe_wait_status(status: libc::c_int) -> String {
    if libc::WIFEXITED(status) {
        format!("exit code {}", libc::WEXITSTATUS(status))
    } else if libc::WIFSIGNALED(status) {
        let sig = libc::WTERMSIG(status);
        let name = match sig {
            libc::SIGABRT => "SIGABRT",
            libc::SIGSEGV => "SIGSEGV",
            libc::SIGILL => "SIGILL",
            libc::SIGBUS => "SIGBUS",
            libc::SIGKILL => "SIGKILL",
            _ => "signal",
        };
        format!("signal {sig} ({name})")
    } else {
        format!("status {status}")
    }
}

/// Download/load a module under the lock, then execute its entry **without**
/// holding the module manager lock so independent tasks run in parallel.
pub async fn run_module(
    mm: &std::sync::Arc<tokio::sync::Mutex<ModuleManager>>,
    name: &str,
    input: serde_json::Value,
) -> String {
    let prepared = {
        let mut mgr = mm.lock().await;
        match mgr.prepare(name, &input.to_string()).await {
            Ok(p) => p,
            Err(e) => return serde_json::json!({ "error": e }).to_string(),
        }
    };
    match execute_module(prepared.0, &prepared.1).await {
        Ok(r) => r,
        Err(e) => serde_json::json!({ "error": e }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_manager_starts_with_nothing_loaded() {
        let mgr = ModuleManager::new(
            "http://127.0.0.1:1",
            "/register",
            "/heartbeat",
            "/result",
            "agent-1".to_string(),
            None,
            None,
        );
        assert!(!mgr.is_loaded("shell"));
    }
}

#[cfg(test)]
mod isolated_tests {
    use super::*;

    /// Fake module entry that returns a fixed JSON payload.
    extern "system" fn fake_ok(
        _input: *const u8,
        _input_len: usize,
        out: *mut u8,
        cap: usize,
    ) -> usize {
        let payload = b"{\"success\":true,\"value\":42}";
        let n = payload.len().min(cap);
        unsafe { std::ptr::copy_nonoverlapping(payload.as_ptr(), out, n) };
        n
    }

    /// Fake module entry that hard-crashes (what a segfault/panic=abort does).
    #[cfg(unix)]
    extern "system" fn fake_crash(
        _input: *const u8,
        _input_len: usize,
        _out: *mut u8,
        _cap: usize,
    ) -> usize {
        unsafe { libc::abort() }
    }

    #[tokio::test]
    async fn isolated_returns_module_output() {
        let result = execute_module_isolated(fake_ok, "{}").await.unwrap();
        assert!(result.contains("\"value\":42"), "{result}");
    }

    #[tokio::test]
    async fn isolated_returns_utf8_error_on_bad_output() {
        extern "system" fn fake_bad(
            _input: *const u8,
            _input_len: usize,
            out: *mut u8,
            cap: usize,
        ) -> usize {
            let payload = [0xFFu8, 0xFE, 0x00, 0x01]; // invalid UTF-8
            let n = payload.len().min(cap);
            unsafe { std::ptr::copy_nonoverlapping(payload.as_ptr(), out, n) };
            n
        }
        let err = execute_module_isolated(fake_bad, "{}").await.unwrap_err();
        assert!(err.contains("UTF-8"), "{err}");
    }

    /// A crashing module must surface as an error — and must NOT take the
    /// test process (the "agent") down. Unix-only: Windows has no fork and
    /// falls back to in-process execution, where this test would be fatal.
    #[cfg(unix)]
    #[tokio::test]
    async fn isolated_crash_is_reported_not_fatal() {
        let err = execute_module_isolated(fake_crash, "{}").await.unwrap_err();
        assert!(err.contains("crashed"), "{err}");
        assert!(err.contains("SIGABRT"), "{err}");
    }
}
