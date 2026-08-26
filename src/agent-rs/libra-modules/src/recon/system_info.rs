use std::env;

pub struct SystemInfo;

impl SystemInfo {
    pub fn collect() -> String {
        let hostname = hostname();
        let user_name =
            env::var("USERNAME").unwrap_or_else(|_| env::var("USER").unwrap_or_default());
        let os_version = Self::get_os_version();
        let platform = std::env::consts::OS;
        let arch = std::env::consts::ARCH;
        let processor_count = num_cpus();
        let is_64bit = cfg!(target_pointer_width = "64");
        let pid = std::process::id();
        let drives = Self::collect_drives();

        format!(
            r#"{{"hostname":"{}","userName":"{}","osVersion":"{}","platform":"{}","arch":"{}","processorCount":{},"is64Bit":{},"pid":{},"drives":[{}]}}"#,
            escape(&hostname),
            escape(&user_name),
            escape(&os_version),
            escape(platform),
            escape(arch),
            processor_count,
            is_64bit,
            pid,
            drives
        )
    }

    pub fn get_os_version() -> String {
        #[cfg(target_os = "windows")]
        {
            // Try to get Windows version from registry
            use std::os::windows::process::CommandExt;
            use std::process::Command;

            // Get ProductName from registry
            let product_name = {
                let output = Command::new("reg")
                    .args([
                        "query",
                        r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion",
                        "/v",
                        "ProductName",
                    ])
                    .creation_flags(0x08000000)
                    .output();
                match output {
                    Ok(o) => {
                        let text = String::from_utf8_lossy(&o.stdout);
                        text.lines()
                            .find(|l| l.contains("ProductName"))
                            .and_then(|l| l.split("REG_SZ").nth(1))
                            .map(|s| s.trim().to_string())
                            .unwrap_or_else(|| "Windows".into())
                    }
                    Err(_) => "Windows".into(),
                }
            };

            let display_version = {
                let output = Command::new("reg")
                    .args([
                        "query",
                        r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion",
                        "/v",
                        "DisplayVersion",
                    ])
                    .creation_flags(0x08000000)
                    .output();
                match output {
                    Ok(o) => {
                        let text = String::from_utf8_lossy(&o.stdout);
                        text.lines()
                            .find(|l| l.contains("DisplayVersion"))
                            .and_then(|l| l.split("REG_SZ").nth(1))
                            .map(|s| s.trim().to_string())
                            .unwrap_or_default()
                    }
                    Err(_) => String::new(),
                }
            };

            if display_version.is_empty() {
                product_name
            } else {
                format!("{} {}", product_name, display_version)
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            // Try to read os-release on Linux
            if let Ok(content) = std::fs::read_to_string("/etc/os-release") {
                for line in content.lines() {
                    if line.starts_with("PRETTY_NAME=") {
                        let val = &line["PRETTY_NAME=".len()..].trim_matches('"');
                        return val.to_string();
                    }
                }
            }
            format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
        }
    }

    fn collect_drives() -> String {
        let mut drives = Vec::new();
        #[cfg(target_os = "windows")]
        {
            for letter in b'A'..=b'Z' {
                let path = format!("{}:\\", letter as char);
                if std::path::Path::new(&path).exists() {
                    let total = get_drive_size(&path);
                    let free = get_drive_free(&path);
                    drives.push(format!(
                        r#"{{"name":"{}","totalGb":{:.1},"freeGb":{:.1}}}"#,
                        escape(&path),
                        total,
                        free
                    ));
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            drives.push(format!(r#"{{"name":"/","totalGb":0,"freeGb":0}}"#));
            if let Ok(entries) = std::fs::read_dir("/mnt") {
                for entry in entries.filter_map(|e| e.ok()) {
                    let path = entry.path().to_string_lossy().to_string();
                    drives.push(format!(
                        r#"{{"name":"{}","totalGb":0,"freeGb":0}}"#,
                        escape(&path)
                    ));
                }
            }
        }
        drives.join(",")
    }
}

fn hostname() -> String {
    #[cfg(target_os = "windows")]
    {
        env::var("COMPUTERNAME").unwrap_or_default()
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(name) = std::process::Command::new("hostname").output() {
            String::from_utf8_lossy(&name.stdout).trim().to_string()
        } else {
            String::new()
        }
    }
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
}

fn get_drive_size(path: &str) -> f64 {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut total: u64 = 0;
        unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                std::ptr::null_mut(),
                &mut total,
                std::ptr::null_mut(),
            );
        }
        if total > 0 {
            return total as f64 / 1_073_741_824.0; // bytes → GiB
        }
    }
    // Fallback: use sysinfo
    for disk in sysinfo::Disks::new_with_refreshed_list().iter() {
        let mount = disk.mount_point().to_string_lossy();
        if mount.as_ref().starts_with(path) || path.starts_with(mount.as_ref()) {
            return disk.total_space() as f64 / 1_073_741_824.0;
        }
    }
    0.0
}

fn get_drive_free(path: &str) -> f64 {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut free: u64 = 0;
        unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut free,
            );
        }
        if free > 0 {
            return free as f64 / 1_073_741_824.0;
        }
    }
    for disk in sysinfo::Disks::new_with_refreshed_list().iter() {
        let mount = disk.mount_point().to_string_lossy();
        if mount.as_ref().starts_with(path) || path.starts_with(mount.as_ref()) {
            return disk.available_space() as f64 / 1_073_741_824.0;
        }
    }
    0.0
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetDiskFreeSpaceExW(
        lpDirectoryName: *const u16,
        lpFreeBytesAvailableToCaller: *mut u64,
        lpTotalNumberOfBytes: *mut u64,
        lpTotalNumberOfFreeBytes: *mut u64,
    ) -> i32;
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
