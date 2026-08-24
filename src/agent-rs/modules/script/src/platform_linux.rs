//! Linux platform API for script plugins.
//!
//! Registered into the Rhai engine only on Linux/macOS, so platform-specific
//! functions (native shell, uname, /proc access) are absent on Windows.
//!
//!   - `core` (always on): `sys.shell`, `sys.bash`, `sys.uname`, `sys.ip_route`
//!   - `full` (opt-in): raw syscall / /proc memory (deliberately stubbed)

use rhai::Engine;
use std::process::Command;

pub fn register_platform_api(engine: &mut Engine, features: &[String]) {
    engine.register_fn("shell", shell);
    engine.register_fn("bash", bash);

    // `sys.uname() -> String` — kernel + hostname + arch.
    engine.register_fn("uname", || -> String {
        run(&["/bin/sh", "-c", "uname -a"])
    });

    // `sys.ip_route() -> String` — `ip addr` output.
    engine.register_fn("ip_route", || -> String {
        run(&["/bin/sh", "-c", "ip addr 2>/dev/null || ifconfig 2>/dev/null"])
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
