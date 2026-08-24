//! Cross-platform capabilities shared by both Windows and Linux script
//! plugins. These are platform-agnostic (filesystem, processes, environment),
//! implemented with std only — no external dependencies.

use rhai::{Array, Dynamic, Engine, Map};
use std::fs;
use std::process::Command;

/// Register the common (platform-agnostic) API: `fs.*`, `proc.*`, `env.*`.
pub fn register_common_api(engine: &mut Engine) {
    // ── fs namespace (map) ────────────────────────────────────────────
    let mut fs_ns = Map::new();
    fs_ns.insert("read".into(), Dynamic::from(read_file as fn(&str) -> String));
    fs_ns.insert("write".into(), Dynamic::from(write_file as fn(&str, &str) -> bool));
    fs_ns.insert("list".into(), Dynamic::from(list_dir as fn(&str) -> Array));
    fs_ns.insert("exists".into(), Dynamic::from(exists as fn(&str) -> bool));
    engine.register_fn("fs", move || fs_ns.clone());

    // ── proc namespace ────────────────────────────────────────────────
    let mut proc_ns = Map::new();
    proc_ns.insert("list".into(), Dynamic::from(list_processes as fn() -> Array));
    proc_ns.insert("kill".into(), Dynamic::from(kill_process as fn(i64) -> bool));
    engine.register_fn("proc", move || proc_ns.clone());

    // ── env namespace ─────────────────────────────────────────────────
    let mut env_ns = Map::new();
    env_ns.insert("get".into(), Dynamic::from(get_env as fn(&str) -> String));
    env_ns.insert("set".into(), Dynamic::from(set_env as fn(&str, &str)));
    engine.register_fn("env", move || env_ns.clone());

    // ── top-level helpers ─────────────────────────────────────────────
    engine.register_fn("whoami", whoami);
    engine.register_fn("log", |msg: &str| {
        eprintln!("[script] {}", msg);
    });
}

fn read_file(path: &str) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| format!("read error: {}", e))
}

fn write_file(path: &str, content: &str) -> bool {
    fs::write(path, content).is_ok()
}

fn list_dir(path: &str) -> Array {
    fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned().into())
                .collect()
        })
        .unwrap_or_default()
}

fn exists(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

/// List running processes. Each element is a map: { pid, name }.
fn list_processes() -> Array {
    let mut out = Array::new();
    #[cfg(target_os = "windows")]
    {
        // Windows: tasklist /FO CSV /NH => "name","pid","session","..." per line.
        if let Ok(o) = Command::new("tasklist").args(["/FO", "CSV", "/NH"]).output() {
            let text = String::from_utf8_lossy(&o.stdout);
            for line in text.lines() {
                let fields: Vec<&str> = line.split(',').map(|s| s.trim_matches('"')).collect();
                if fields.len() >= 2 {
                    let mut m = Map::new();
                    m.insert("name".into(), fields[0].into());
                    if let Ok(pid) = fields[1].parse::<i64>() {
                        m.insert("pid".into(), pid.into());
                    }
                    out.push(Dynamic::from(m));
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Linux: ps -eo pid=,comm=
        if let Ok(o) = Command::new("ps").args(["-eo", "pid=,comm="]).output() {
            let text = String::from_utf8_lossy(&o.stdout);
            for line in text.lines() {
                let mut it = line.splitn(2, char::is_whitespace);
                if let (Some(pid_s), Some(name)) = (it.next(), it.next()) {
                    let mut m = Map::new();
                    if let Ok(pid) = pid_s.trim().parse::<i64>() {
                        m.insert("pid".into(), pid.into());
                    }
                    m.insert("name".into(), name.trim().into());
                    out.push(Dynamic::from(m));
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

fn get_env(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

fn set_env(name: &str, value: &str) {
    // SAFETY note: std::env::set_var is only safe in single-threaded contexts.
    // The agent is multi-threaded, so we deliberately refuse to mutate the
    // process environment here to avoid UB. This is a no-op placeholder.
    let _ = (name, value);
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
