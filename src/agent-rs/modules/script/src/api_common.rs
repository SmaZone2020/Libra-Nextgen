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
        if let Ok(o) = Command::new("tasklist").args(["/FO", "CSV", "/NH"]).output() {
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
