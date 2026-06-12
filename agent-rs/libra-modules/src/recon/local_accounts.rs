pub struct LocalAccountEnumerator;

impl LocalAccountEnumerator {
    /// Enumerate all local user accounts.
    /// On Windows, uses PowerShell (in-memory Runspace equivalent via powershell.exe).
    /// On Linux, reads /etc/passwd.
    pub async fn enumerate() -> String {
        #[cfg(target_os = "windows")]
        {
            return Self::enumerate_windows().await;
        }
        #[cfg(not(target_os = "windows"))]
        {
            return Self::enumerate_linux();
        }
    }

    #[cfg(target_os = "windows")]
    async fn enumerate_windows() -> String {
        use std::os::windows::process::CommandExt;

        let script = r#"
$admins = @{}
Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue | ForEach-Object {
    $n = $_.Name -replace '^.*\\', ''
    $admins[$n] = $true
}
Get-LocalUser | ForEach-Object {
    $isAdmin = [bool]$admins[$_.Name]
    $grps = if ($isAdmin) { @('Administrators') } else { @() }
    $_ | Add-Member -NotePropertyName 'isAdmin' -NotePropertyValue $isAdmin -Force
    $_ | Add-Member -NotePropertyName 'sidValue' -NotePropertyValue $_.SID.Value -Force
    $_ | Add-Member -NotePropertyName 'groups' -NotePropertyValue $grps -Force
    $_
} | Select-Object Name, FullName, Description, Enabled, isAdmin, sidValue, groups,
    PasswordRequired, UserMayChangePassword, LastLogon, AccountExpires,
    PasswordLastSet, PasswordExpires, ObjectClass, PrincipalSource |
ConvertTo-Json -Compress
"#;

        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        match output {
            Ok(o) => {
                let json = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if json.is_empty() {
                    return r#"{"accounts":[]}"#.to_string();
                }
                // Find the JSON array
                if let Some(start) = json.find('[') {
                    if let Some(end) = json.rfind(']') {
                        let inner = &json[start..=end];
                        return format!(r#"{{"accounts":{}}}"#, inner);
                    }
                }
                r#"{"accounts":[]}"#.to_string()
            }
            Err(_) => r#"{"accounts":[]}"#.to_string(),
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn enumerate_linux() -> String {
        let mut accounts = Vec::new();
        if let Ok(content) = std::fs::read_to_string("/etc/passwd") {
            for line in content.lines() {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 7 {
                    let name = parts[0];
                    let uid: u32 = parts[2].parse().unwrap_or(0);
                    let gid: u32 = parts[3].parse().unwrap_or(0);
                    let gecos = parts[4];
                    let home = parts[5];
                    let shell = parts[6];

                    // Skip system accounts (uid < 1000 typically)
                    let is_admin = uid == 0;
                    let enabled = shell != "/usr/sbin/nologin" && shell != "/bin/false";

                    let full_name = gecos.split(',').next().unwrap_or("");

                    accounts.push(format!(
                        r#"{{"Name":"{}","FullName":"{}","Description":"","Enabled":{},"isAdmin":{},"sidValue":"{}","groups":[{}],"PasswordRequired":false,"UserMayChangePassword":false,"LastLogon":null,"AccountExpires":null,"PasswordLastSet":null,"PasswordExpires":null,"ObjectClass":"User","PrincipalSource":"Local"}}"#,
                        escape(name),
                        escape(full_name),
                        enabled,
                        is_admin,
                        escape(&format!("S-1-0-{}", uid)),
                        if is_admin { "\"Administrators\"" } else { "" }
                    ));
                }
            }
        }
        format!(r#"{{"accounts":[{}]}}"#, accounts.join(","))
    }
}

#[cfg(not(target_os = "windows"))]
fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
