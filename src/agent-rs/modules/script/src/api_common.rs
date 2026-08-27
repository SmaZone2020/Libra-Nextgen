//! Cross-platform capabilities shared by both Windows and Linux script
//! plugins. These are platform-agnostic (filesystem, processes, environment),
//! implemented with std only — no external dependencies.
//!
//! Exposed to JS as globals:
//!   fs.read(path) -> string        fs.write(path, content) -> boolean
//!   fs.list(path) -> string[]      fs.exists(path) -> boolean
//!   proc.list() -> [{pid, name}]   proc.kill(pid) -> boolean
//!   env.get(name) -> string        env.set(name, value) -> void (no-op)
//!   whoami() -> string             log(msg) -> void (agent log)
//!   exec.run(program, args[], {env, cwd, timeoutSeconds}) -> {success, exitCode, stdout, stderr, timedOut}
//!   exec.spawn(program, args[], {env, cwd}) -> {success, pid}

use rquickjs::{Ctx, Function, Object};
use std::fs;
use std::process::Command;

pub fn register_common_api(ctx: &Ctx, platform: &str) {
    let globals = ctx.globals();

    // ── fs namespace ──────────────────────────────────────────────────
    let fs_obj = Object::new(ctx.clone()).expect("create fs object");
    let _ = fs_obj.set("read", Function::new(ctx.clone(), read_file));
    let _ = fs_obj.set("write", Function::new(ctx.clone(), write_file));
    let _ = fs_obj.set("list", Function::new(ctx.clone(), list_dir));
    let _ = fs_obj.set("exists", Function::new(ctx.clone(), exists));
    let _ = globals.set("fs", fs_obj);

    // ── proc namespace ────────────────────────────────────────────────
    let proc_obj = Object::new(ctx.clone()).expect("create proc object");
    let _ = proc_obj.set("list", Function::new(ctx.clone(), list_processes));
    let _ = proc_obj.set("kill", Function::new(ctx.clone(), kill_process));
    let _ = globals.set("proc", proc_obj);

    // ── env namespace ─────────────────────────────────────────────────
    let env_obj = Object::new(ctx.clone()).expect("create env object");
    let _ = env_obj.set("get", Function::new(ctx.clone(), get_env));
    let _ = env_obj.set("set", Function::new(ctx.clone(), set_env));
    let _ = globals.set("env", env_obj);

    // ── exec namespace: fork-and-run in a fresh child process ─────────
    let exec_obj = Object::new(ctx.clone()).expect("create exec object");
    let _ = exec_obj.set("run", Function::new(ctx.clone(), exec_run));
    let _ = exec_obj.set("spawn", Function::new(ctx.clone(), exec_spawn));
    let _ = globals.set("exec", exec_obj);

    // ── top-level helpers ─────────────────────────────────────────────
    let _ = globals.set("whoami", Function::new(ctx.clone(), whoami));
    let _ = globals.set("log", Function::new(ctx.clone(), log));

    // ── runtime platform branch ───────────────────────────────────────
    let platform_str = platform.to_string();
    let _ = globals.set(
        "__platform",
        Function::new(ctx.clone(), move || platform_str.clone()),
    );
}

fn read_file(path: String) -> String {
    fs::read_to_string(&path).unwrap_or_else(|e| format!("read error: {}", e))
}

fn write_file(path: String, content: String) -> bool {
    fs::write(&path, content).is_ok()
}

fn list_dir(path: String) -> Vec<String> {
    fs::read_dir(&path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

fn exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// List running processes. Each element is a JS object: { pid, name }.
/// Takes the live `Ctx` so per-item objects belong to the current runtime.
fn list_processes(ctx: Ctx) -> Vec<Object> {
    let mut out: Vec<Object> = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Ok(o) = Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .output()
        {
            let text = String::from_utf8_lossy(&o.stdout);
            for line in text.lines() {
                let fields: Vec<&str> = line.split(',').map(|s| s.trim_matches('"')).collect();
                if fields.len() >= 2 {
                    let obj = Object::new(ctx.clone()).expect("create process object");
                    let _ = obj.set("name", fields[0]);
                    if let Ok(pid) = fields[1].parse::<i64>() {
                        let _ = obj.set("pid", pid);
                    }
                    out.push(obj);
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(o) = Command::new("ps").args(["-eo", "pid=,comm="]).output() {
            let text = String::from_utf8_lossy(&o.stdout);
            for line in text.lines() {
                let mut it = line.splitn(2, char::is_whitespace);
                if let (Some(pid_s), Some(name)) = (it.next(), it.next()) {
                    let obj = Object::new(ctx.clone()).expect("create process object");
                    if let Ok(pid) = pid_s.trim().parse::<i64>() {
                        let _ = obj.set("pid", pid);
                    }
                    let _ = obj.set("name", name.trim());
                    out.push(obj);
                }
            }
        }
    }
    out
}

fn kill_process(pid: i64) -> bool {
    #[cfg(target_os = "windows")]
    {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("kill")
            .arg(pid.to_string())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

fn get_env(name: String) -> String {
    std::env::var(name).unwrap_or_default()
}

fn set_env(_name: String, _value: String) {
    // std::env::set_var is only safe in single-threaded contexts; the agent is
    // multi-threaded, so mutating the process environment is deliberately
    // refused (would be UB). This is a no-op placeholder.
}

fn whoami() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERNAME").unwrap_or_default()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("USER").unwrap_or_default()
    }
}

fn log(msg: String) {
    libra_common::dlog!("[script] {}", msg);
}

// ── exec namespace: fork-and-run via ProcessExecutor ─────────────────────

/// `exec.run(program, args, {env, cwd, timeoutSeconds})` — run a program in a
/// fresh child process and wait for its output (with kill-on-timeout).
fn exec_run(program: String, args: Vec<String>, opts: Object) -> String {
    let (env, cwd, timeout_secs) = parse_opts(&opts);

    let mut exe = libra_platform::process::ProcessExecutor::new(program);
    for a in args {
        exe.arg(a);
    }
    for (k, v) in env {
        exe.env(k, v);
    }
    if let Some(dir) = cwd {
        exe.current_dir(dir);
    }

    run_with_timeout(&mut exe, timeout_secs)
}

/// `exec.spawn(program, args, {env, cwd})` — detached background process,
/// returns its PID immediately.
fn exec_spawn(program: String, args: Vec<String>, opts: Object) -> String {
    let (env, cwd, _) = parse_opts(&opts);

    let mut exe = libra_platform::process::ProcessExecutor::new(program);
    for a in args {
        exe.arg(a);
    }
    for (k, v) in env {
        exe.env(k, v);
    }
    if let Some(dir) = cwd {
        exe.current_dir(dir);
    }
    exe.detached(true);

    match exe.spawn() {
        Ok(child) => serde_json::json!({ "success": true, "pid": child.pid() }).to_string(),
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }).to_string(),
    }
}

/// Extract `{env: {k:v}, cwd: string, timeoutSeconds: int}` from the opts
/// object (missing keys are fine).
fn parse_opts(opts: &Object) -> (Vec<(String, String)>, Option<String>, u64) {
    let mut env = Vec::new();
    if let Ok(env_obj) = opts.get::<_, Object>("env") {
        for k in env_obj.keys::<String>() {
            if let Ok(k) = k {
                if let Ok(v) = env_obj.get::<_, String>(&k) {
                    env.push((k, v));
                }
            }
        }
    }
    let cwd: Option<String> = opts.get("cwd").ok().flatten();
    let timeout_secs: u64 = opts
        .get::<_, Option<i64>>("timeoutSeconds")
        .ok()
        .flatten()
        .filter(|&t| t > 0)
        .unwrap_or(30) as u64;
    (env, cwd, timeout_secs)
}

/// Spawn, drain both pipes on worker threads, wait with a timeout, kill on
/// timeout. Returns a JSON result string (same shape as the forkexec module).
fn run_with_timeout(exe: &mut libra_platform::process::ProcessExecutor, timeout_secs: u64) -> String {
    let mut child = match exe.spawn() {
        Ok(c) => c,
        Err(e) => {
            return serde_json::json!({ "success": false, "error": e.to_string() }).to_string()
        }
    };

    let stdout = child
        .take_stdout()
        .map(|f| std::thread::spawn(move || read_all(f)));
    let stderr = child
        .take_stderr()
        .map(|f| std::thread::spawn(move || read_all(f)));

    let (timed_out, status) = match child.wait_timeout(std::time::Duration::from_secs(timeout_secs)) {
        Ok(Some(status)) => (false, status),
        Ok(None) => {
            let _ = child.kill();
            let status = child.wait().unwrap_or(libra_platform::process::ExitStatus::new(130));
            (true, status)
        }
        Err(e) => {
            return serde_json::json!({ "success": false, "error": e.to_string() }).to_string()
        }
    };

    let stdout = stdout.and_then(|h| h.join().ok()).unwrap_or_default();
    let stderr = stderr.and_then(|h| h.join().ok()).unwrap_or_default();

    serde_json::json!({
        "success": !timed_out && status.success(),
        "exitCode": status.code(),
        "stdout": String::from_utf8_lossy(&stdout).into_owned(),
        "stderr": String::from_utf8_lossy(&stderr).into_owned(),
        "timedOut": timed_out,
    })
    .to_string()
}

fn read_all(mut f: std::fs::File) -> Vec<u8> {
    use std::io::Read;
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine;

    #[cfg(windows)]
    const ECHO: [&str; 3] = ["cmd", "/C", "echo"];
    #[cfg(not(windows))]
    const ECHO: [&str; 2] = ["/bin/echo", "-n"];

    #[test]
    fn exec_run_from_js() {
        let mut script = String::from("function main(args) { return exec.run(\"");
        script.push_str(ECHO[0]);
        script.push_str("\", [");
        for a in &ECHO[1..] {
            script.push_str("\"");
            script.push_str(a);
            script.push_str("\", ");
        }
        script.push_str("\"plugin-hello\"], {}); }");

        let out = engine::execute(&script, &serde_json::json!({}), "main", &[]).unwrap();
        let s = out.as_str().unwrap();
        assert!(s.contains("plugin-hello"), "{s}");
        assert!(s.contains("\"exitCode\":0"), "{s}");
    }

    #[test]
    fn exec_spawn_from_js() {
        #[cfg(windows)]
        let script = "function main(args) { return exec.spawn(\"cmd\", [\"/C\", \"timeout\", \"/t\", \"1\", \"/nobreak\", \">nul\"], {}); }";
        #[cfg(not(windows))]
        let script = "function main(args) { return exec.spawn(\"/bin/sleep\", [\"1\"], {}); }";

        let out = engine::execute(script, &serde_json::json!({}), "main", &[]).unwrap();
        let s = out.as_str().unwrap();
        assert!(s.contains("\"success\":true"), "{s}");
        assert!(s.contains("\"pid\""), "{s}");
    }

    #[test]
    fn exec_run_timeout_from_js() {
        #[cfg(windows)]
        let script = "function main(args) { return exec.run(\"cmd\", [\"/C\", \"ping\", \"-n\", \"31\", \"127.0.0.1\", \">nul\"], {timeoutSeconds: 1}); }";
        #[cfg(not(windows))]
        let script = "function main(args) { return exec.run(\"/bin/sh\", [\"-c\", \"sleep 30\"], {timeoutSeconds: 1}); }";

        let out = engine::execute(script, &serde_json::json!({}), "main", &[]).unwrap();
        let s = out.as_str().unwrap();
        assert!(s.contains("\"timedOut\":true"), "{s}");
        assert!(s.contains("\"success\":false"), "{s}");
    }

    #[test]
    fn exec_run_missing_program_returns_error() {
        let script =
            "function main(args) { return exec.run(\"definitely-not-a-real-binary-xyz\", [], {}); }";
        let out = engine::execute(script, &serde_json::json!({}), "main", &[]).unwrap();
        let s = out.as_str().unwrap();
        assert!(s.contains("\"success\":false"), "{s}");
    }
}
