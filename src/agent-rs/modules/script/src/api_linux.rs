//! Linux/macOS platform API for script plugins.
//!
//! Registered into the JS runtime only when NOT running on Windows, so
//! platform-specific functions (native shell, uname, /proc access) are absent
//! on Windows.
//!
//!   - `core` (always on): `shell`, `bash`, `uname`, `ip_route`, `ss`,
//!     `proc_read`, `hostname`, `dns`
//!   - `full` (opt-in): raw syscall / /proc memory (deliberately stubbed)

use rquickjs::{Ctx, Function};
use std::process::Command;

pub fn register_linux_api(ctx: &Ctx, features: &[String]) {
    let globals = ctx.globals();
    let _ = globals.set("shell", Function::new(ctx.clone(), shell));
    let _ = globals.set("bash", Function::new(ctx.clone(), bash));

    let _ = globals.set("uname", Function::new(ctx.clone(), || -> String {
        run(&["/bin/sh", "-c", "uname -a"])
    }));
    let _ = globals.set("ip_route", Function::new(ctx.clone(), || -> String {
        run(&["/bin/sh", "-c", "ip addr 2>/dev/null || ifconfig 2>/dev/null"])
    }));
    let _ = globals.set("ss", Function::new(ctx.clone(), |path: String| -> String {
        // Read a /proc or /sys file (e.g. "/proc/cpuinfo", "/proc/version").
        std::fs::read_to_string(&path).unwrap_or_else(|e| format!("read error: {}", e))
    }));
    let _ = globals.set("hostname", Function::new(ctx.clone(), || -> String {
        run(&["/bin/sh", "-c", "hostname"])
    }));
    let _ = globals.set("dns", Function::new(ctx.clone(), || -> String {
        run(&["/bin/sh", "-c", "cat /etc/resolv.conf 2>/dev/null"])
    }));

    if features.iter().any(|f| f == "full") {
        let _ = globals.set("__syscall_reserved", Function::new(ctx.clone(), || "syscall full-stack not yet wired"));
    }
}

fn shell(cmdline: String) -> String {
    run(&["/bin/sh", "-c", cmdline.as_str()])
}

fn bash(script: String) -> String {
    run(&["/bin/bash", "-c", script.as_str()])
}

fn run(argv: &[&str]) -> String {
    let (prog, args) = argv
        .split_first()
        .map(|(p, rest)| (*p, rest))
        .unwrap_or(("/bin/sh", &[][..]));
    match Command::new(prog).args(args).output() {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&o.stderr).into_owned();
            if stdout.trim().is_empty() {
                stderr
            } else {
                stdout
            }
        }
        Err(e) => format!("failed to spawn {}: {}", prog, e),
    }
}
