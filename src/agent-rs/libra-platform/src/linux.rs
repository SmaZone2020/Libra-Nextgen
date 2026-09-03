use crate::platform::{DriveInfo, IPlatformExecutor, InteractiveShellHandle, SpecialDir};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use tokio::process::Command;
use tokio::sync::watch;

pub struct LinuxExecutor {
    shell: String,
}

impl LinuxExecutor {
    pub fn new() -> Self {
        let shell = if std::path::Path::new("/bin/bash").exists() {
            "/bin/bash".into()
        } else if std::path::Path::new("/bin/zsh").exists() {
            "/bin/zsh".into()
        } else {
            "/bin/sh".into()
        };
        Self { shell }
    }
}

impl IPlatformExecutor for LinuxExecutor {
    fn get_default_shell(&self) -> &str {
        &self.shell
    }

    fn is_available(&self) -> bool {
        cfg!(unix)
    }

    fn execute(&self, command: &str) -> Pin<Box<dyn Future<Output = String> + Send + '_>> {
        let shell = self.shell.clone();
        let command = command.to_string();
        Box::pin(async move {
            let output = Command::new(&shell)
                .args(["-c", &command])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .output()
                .await;

            match output {
                Ok(out) => {
                    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    if stdout.is_empty() {
                        stderr
                    } else {
                        stdout
                    }
                }
                Err(e) => format!("Failed to start process: {}", e),
            }
        })
    }

    fn start_interactive_shell(&self) -> InteractiveShellHandle {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("failed to open PTY");

        let cmd = CommandBuilder::new(&self.shell);
        let child = pair
            .slave
            .spawn_command(cmd)
            .expect("failed to spawn shell on PTY");
        drop(pair.slave);

        let writer = pair.master.take_writer().expect("no pty writer");
        let reader = pair.master.try_clone_reader().expect("no pty reader");

        let (cancel_tx, _) = watch::channel(false);
        InteractiveShellHandle {
            child,
            master: pair.master,
            reader,
            writer,
            cancel_tx,
        }
    }

    fn get_drives(&self) -> Vec<String> {
        let mut drives = vec!["/".to_string()];
        if let Ok(entries) = std::fs::read_dir("/mnt") {
            for entry in entries.filter_map(|e| e.ok()) {
                drives.push(entry.path().to_string_lossy().to_string());
            }
        }
        if let Ok(entries) = std::fs::read_dir("/media") {
            for entry in entries.filter_map(|e| e.ok()) {
                drives.push(entry.path().to_string_lossy().to_string());
            }
        }
        drives
    }

    fn drive_info(&self) -> Vec<DriveInfo> {
        use std::os::unix::fs::MetadataExt;
        let mut out = Vec::new();

        // Candidate mounts: skip pseudo filesystems so we only show real volumes.
        let skip: &[&str] = &[
            "proc",
            "sysfs",
            "devpts",
            "devtmpfs",
            "tmpfs",
            "cgroup",
            "cgroup2",
            "pstore",
            "securityfs",
            "debugfs",
            "tracefs",
            "mqueue",
            "hugetlbfs",
            "configfs",
            "binfmt_misc",
            "overlay",
            "squashfs",
            "autofs",
            "rpc_pipefs",
        ];
        let net_fs: &[&str] = &[
            "nfs",
            "nfs4",
            "cifs",
            "smb3",
            "fuse.sshfs",
            "fuse.glusterfs",
        ];
        let rem_fs: &[&str] = &["vfat", "exfat", "ntfs", "fuseblk", "iso9660"];

        if let Ok(mounts) = std::fs::read_to_string("/proc/self/mounts") {
            for line in mounts.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 3 {
                    continue;
                }
                let fs_type = parts[2];
                if skip.iter().any(|s| fs_type.starts_with(s)) {
                    continue;
                }
                let path = parts[1].replace("\\040", " ").replace("\\011", "\t");
                if path.is_empty() || !std::path::Path::new(&path).is_dir() {
                    continue;
                }
                let kind = if net_fs.contains(&fs_type) {
                    "network"
                } else if rem_fs.contains(&fs_type) {
                    "removable"
                } else if path == "/" {
                    "local"
                } else {
                    "local"
                };
                let mut total = 0u64;
                let mut free = 0u64;
                unsafe {
                    let mut stat = std::mem::zeroed::<libc::statvfs>();
                    if libc::statvfs(
                        std::ffi::CString::new(path.as_str())
                            .unwrap_or_default()
                            .as_ptr(),
                        &mut stat,
                    ) == 0
                    {
                        let bsize = stat.f_frsize as u64;
                        total = (stat.f_blocks as u64).saturating_mul(bsize);
                        free = (stat.f_bavail as u64).saturating_mul(bsize);
                    }
                }
                if total == 0 {
                    continue;
                }
                out.push(DriveInfo {
                    path: path.clone(),
                    kind: kind.to_string(),
                    total,
                    free,
                });
            }
        }
        out.sort_by(|a, b| b.total.cmp(&a.total));
        out.dedup_by(|a, b| a.path == b.path);
        out
    }

    fn special_dirs(&self) -> Vec<SpecialDir> {
        let home = std::env::var("HOME").unwrap_or_default();
        let mut out = Vec::new();
        if !home.is_empty() {
            let candidates = [
                ("desktop", "Desktop"),
                ("downloads", "Downloads"),
                ("documents", "Documents"),
                ("pictures", "Pictures"),
                ("music", "Music"),
                ("videos", "Videos"),
            ];
            for (key, dir) in candidates {
                let p = PathBuf::from(&home).join(dir);
                if p.is_dir() {
                    out.push(SpecialDir {
                        name: key.to_string(),
                        path: p.to_string_lossy().to_string(),
                    });
                }
            }
            out.push(SpecialDir {
                name: "user".to_string(),
                path: home.clone(),
            });
        }
        out
    }
}
