//! Docker / container detection and container inventory.
//!
//! Detects whether the host runs (or is inside) Docker, checks the CLI and
//! socket, and lists containers when the docker CLI is usable.

pub struct Docker;

impl Docker {
    pub fn collect() -> String {
        let in_container = Self::inside_container();
        let socket_present = std::path::Path::new("/var/run/docker.sock").exists();
        let cli_available = Self::cli_available();

        let containers = if cli_available {
            Self::list_containers()
        } else {
            Vec::new()
        };

        format!(
            r#"{{"inContainer":{},"socketPresent":{},"cliAvailable":{},"total":{},"containers":[{}]}}"#,
            in_container,
            socket_present,
            cli_available,
            containers.len(),
            containers.join(","),
        )
    }

    fn inside_container() -> bool {
        // Marker file used by Docker; also cgroup hint.
        if std::path::Path::new("/.dockerenv").exists() {
            return true;
        }
        if std::path::Path::new("/run/.containerenv").exists() {
            return true;
        }
        // /proc/1/cgroup lists the container runtime path on modern systems.
        if let Ok(content) = std::fs::read_to_string("/proc/1/cgroup") {
            return content.contains("docker") || content.contains("containerd") || content.contains("kubepods");
        }
        false
    }

    fn cli_available() -> bool {
        std::process::Command::new("docker")
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    fn list_containers() -> Vec<String> {
        let out = match std::process::Command::new("docker")
            .args(["ps", "-a", "--format", "{{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
            Err(_) => return Vec::new(),
        };

        out.lines()
            .filter_map(|l| {
                let mut it = l.split('\t');
                let id = it.next()?.trim();
                let image = it.next().unwrap_or("").trim();
                let status = it.next().unwrap_or("").trim();
                let name = it.next().unwrap_or("").trim();
                if id.is_empty() {
                    return None;
                }
                Some(format!(
                    r#"{{"id":"{}","name":"{}","image":"{}","status":"{}"}}"#,
                    escape(id),
                    escape(name),
                    escape(image),
                    escape(status),
                ))
            })
            .collect()
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
