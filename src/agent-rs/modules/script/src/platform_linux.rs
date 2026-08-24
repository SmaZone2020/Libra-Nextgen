//! Linux platform API for script plugins.
//!
//! Registered into the Rhai engine only on Linux/macOS, so platform-specific
//! functions (native shell, uname, /proc access) are absent on Windows.
//!
//!   - `core` (always on): `shell`, `bash`, `uname`, `ip_route`, `ss`,
//!     `proc_read`, `hostname`, `dns`
//!   - `full` (opt-in): raw syscall / /proc memory (deliberately stubbed)

use rhai::Engine;
use std::process::Command;

pub fn register_platform_api(engine: &mut Engine, features: &[String]) {
    engine.register_fn("shell", shell);
    engine.register_fn("bash", bash);

    engine.register_fn("uname", || -> String {
        run(&["/bin/sh", "-c", "uname -a"])
    });

    engine.register_fn("ip_route", || -> String {
        run(&["/bin/sh", "-c", "ip addr 2>/dev/null || ifconfig 2>/dev/null"])
    });

    engine.register_fn("ss", |path: &str| -> String {
        // Read a /proc or /sys file (e.g. "/proc/cpuinfo", "/proc/version").
        std::fs::read_to_string(path).unwrap_or_else(|e| format!("read error: {}", e))
    });

    engine.register_fn("hostname", || -> String {
        run(&["/bin/sh", "-c", "hostname"])
    });

    engine.register_fn("dns", || -> String {
        run(&["/bin/sh", "-c", "cat /etc/resolv.conf 2>/dev/null"])
    });

    if features.iter().any(|f| f == "full") {
        register_full_api(engine);
    }
}

fn shell(cmdline: &str) -> String {
    run(&["/bin/sh", "-c", cmdline])
}

fn bash(script: &str) -> String {
    run(&["/bin/bash", "-c", script])
}

fn run(argv: &[&str]) -> String {
    let (prog, args) = argv.split_first().map(|(p, rest)| (p, rest)).unwrap_or(("/bin/sh", &[][..]));
    match Command::new(prog).args(args).output() {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&o.stderr).into_owned();
            if stdout.trim().is_empty() { stderr } else { stdout }
        }
        Err(e) => format!("failed to spawn {}: {}", prog, e),
    }
}

fn register_full_api(engine: &mut Engine) {
    engine.register_fn("__syscall_reserved", || "syscall full-stack not yet wired");
}
