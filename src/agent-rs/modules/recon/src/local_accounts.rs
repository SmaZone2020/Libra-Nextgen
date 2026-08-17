pub struct LocalAccountEnumerator;

impl LocalAccountEnumerator {
    pub async fn enumerate() -> String {
        #[cfg(target_os = "windows")]
        {
            let result = Self::enumerate_via_powershell().await;
            if !result.is_empty() && result != r#"{"accounts":[]}"# {
                return result;
            }
            Self::enumerate_via_wmic()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Self::enumerate_linux()
        }
    }

    #[cfg(target_os = "windows")]
    async fn enumerate_via_powershell() -> String {
        use std::os::windows::process::CommandExt;

        // Use SID S-1-5-32-544 for Administrators group (locale-independent)
        let script = r#"
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$adminSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
$adminGroup = $adminSid.Translate([System.Security.Principal.NTAccount]).Value -replace '^.*\\',''
$admins = @{}
try {
    Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction SilentlyContinue | ForEach-Object {
        $n = $_.Name -replace '^.*\\', ''
        $admins[$n] = $true
    }
} catch {
    try {
        net localgroup $adminGroup 2>$null | Where-Object { $_ -and $_ -notmatch '---' -and $_ -notmatch 'command completed' -and $_ -notmatch 'Members' -and $_ -notmatch 'Alias' -and $_ -notmatch 'Comment' } | ForEach-Object {
            $admins[$_.Trim()] = $true
        }
    } catch {}
}
try {
    Get-LocalUser -ErrorAction Stop | ForEach-Object {
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
} catch {
    "[]"
}
"#;

        match std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            Ok(o) => {
                let raw = o.stdout;
                let json = String::from_utf8_lossy(&raw).trim().to_string();
                if json.is_empty() || json == "[]" {
                    return r#"{"accounts":[]}"#.to_string();
                }
                // PowerShell outputs a single object (not array) if only one user
                if json.starts_with('{') {
                    return format!(r#"{{"accounts":[{}]}}"#, json);
                }
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

    /// Fallback using WMIC (locale-independent, works on Home editions)
    #[cfg(target_os = "windows")]
    fn enumerate_via_wmic() -> String {
        use std::os::windows::process::CommandExt;

        // Get admin members via SID-based net localgroup with wmic fallback
        let mut admins = std::collections::HashSet::new();

        // Try wmic to get admin group members (locale-independent via SID)
        if let Ok(o) = std::process::Command::new("wmic")
            .args(["path", "Win32_GroupUser", "where",
                   r#"GroupComponent="Win32_Group.Domain='%COMPUTERNAME%',Name='Administrators'""#,
                   "get", "PartComponent", "/format:csv"])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            let text = String::from_utf8_lossy(&o.stdout);
            for line in text.lines().skip(1) {
                // Extract username from PartComponent string
                if let Some(name_start) = line.find("Name=\"") {
                    let rest = &line[name_start + 6..];
                    if let Some(name_end) = rest.find('"') {
                        admins.insert(rest[..name_end].to_lowercase());
                    }
                }
            }
        }

        // If wmic failed, try net localgroup with both English and Chinese group names
        if admins.is_empty() {
            for group_name in &["Administrators", "管理员"] {
                if let Ok(o) = std::process::Command::new("net")
                    .args(["localgroup", group_name])
                    .creation_flags(0x08000000)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .output()
                {
                    if o.status.success() {
                        let text = String::from_utf8_lossy(&o.stdout);
                        let mut in_members = false;
                        for line in text.lines() {
                            if line.contains("---") {
                                in_members = true;
                                continue;
                            }
                            if in_members {
                                let trimmed = line.trim();
                                if trimmed.is_empty() || trimmed.contains("command completed")
                                    || trimmed.contains("命令成功完成") {
                                    break;
                                }
                                admins.insert(trimmed.to_lowercase());
                            }
                        }
                        if !admins.is_empty() { break; }
                    }
                }
            }
        }

        // Get all users via wmic (locale-independent field names)
        let mut accounts = Vec::new();
        if let Ok(o) = std::process::Command::new("wmic")
            .args(["useraccount", "where", "LocalAccount=TRUE", "get",
                   "Name,FullName,Description,Disabled,SID", "/format:csv"])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            let text = String::from_utf8_lossy(&o.stdout);
            let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
            if lines.len() >= 2 {
                // CSV header: Node,Description,Disabled,FullName,Name,SID
                let headers: Vec<&str> = lines[0].split(',').map(|s| s.trim()).collect();
                let desc_idx = headers.iter().position(|h| h.eq_ignore_ascii_case("Description"));
                let disabled_idx = headers.iter().position(|h| h.eq_ignore_ascii_case("Disabled"));
                let fullname_idx = headers.iter().position(|h| h.eq_ignore_ascii_case("FullName"));
                let name_idx = headers.iter().position(|h| h.eq_ignore_ascii_case("Name"));
                let sid_idx = headers.iter().position(|h| h.eq_ignore_ascii_case("SID"));

                for line in &lines[1..] {
                    let fields: Vec<&str> = line.split(',').collect();
                    let name = name_idx.and_then(|i| fields.get(i)).unwrap_or(&"").trim();
                    if name.is_empty() { continue; }
                    let full_name = fullname_idx.and_then(|i| fields.get(i)).unwrap_or(&"").trim();
                    let description = desc_idx.and_then(|i| fields.get(i)).unwrap_or(&"").trim();
                    let disabled_str = disabled_idx.and_then(|i| fields.get(i)).unwrap_or(&"FALSE").trim();
                    let enabled = !disabled_str.eq_ignore_ascii_case("TRUE");
                    let sid = sid_idx.and_then(|i| fields.get(i)).unwrap_or(&"").trim();
                    let is_admin = admins.contains(&name.to_lowercase());
                    let groups = if is_admin { r#"["Administrators"]"# } else { "[]" };

                    accounts.push(format!(
                        r#"{{"Name":"{}","FullName":"{}","Description":"{}","Enabled":{},"isAdmin":{},"sidValue":"{}","groups":{},"PasswordRequired":false,"UserMayChangePassword":false,"LastLogon":null,"AccountExpires":null,"PasswordLastSet":null,"PasswordExpires":null,"ObjectClass":"User","PrincipalSource":"Local"}}"#,
                        escape(name),
                        escape(full_name),
                        escape(description),
                        enabled,
                        is_admin,
                        escape(sid),
                        groups
                    ));
                }
            }
        }

        // Final fallback: net user
        if accounts.is_empty() {
            accounts = Self::fallback_net_user(&admins);
        }

        format!(r#"{{"accounts":[{}]}}"#, accounts.join(","))
    }

    #[cfg(target_os = "windows")]
    fn fallback_net_user(admins: &std::collections::HashSet<String>) -> Vec<String> {
        use std::os::windows::process::CommandExt;
        let mut accounts = Vec::new();

        if let Ok(o) = std::process::Command::new("net")
            .args(["user"])
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            let text = String::from_utf8_lossy(&o.stdout);
            let mut in_users = false;
            for line in text.lines() {
                if line.contains("---") {
                    in_users = true;
                    continue;
                }
                if in_users {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.contains("command completed")
                        || trimmed.contains("命令成功完成") {
                        break;
                    }
                    for name in trimmed.split_whitespace() {
                        if !name.is_empty() {
                            let is_admin = admins.contains(&name.to_lowercase());
                            let groups = if is_admin { r#"["Administrators"]"# } else { "[]" };
                            accounts.push(format!(
                                r#"{{"Name":"{}","FullName":"","Description":"","Enabled":true,"isAdmin":{},"sidValue":"","groups":{},"PasswordRequired":false,"UserMayChangePassword":false,"LastLogon":null,"AccountExpires":null,"PasswordLastSet":null,"PasswordExpires":null,"ObjectClass":"User","PrincipalSource":"Local"}}"#,
                                escape(name),
                                is_admin,
                                groups
                            ));
                        }
                    }
                }
            }
        }
        accounts
    }

    #[cfg(not(target_os = "windows"))]
    fn enumerate_linux() -> String {
        let mut accounts = Vec::new();
        let mut admin_users = std::collections::HashSet::new();

        // Check /etc/group for sudo/wheel membership
        if let Ok(content) = std::fs::read_to_string("/etc/group") {
            for line in content.lines() {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 4 {
                    let group_name = parts[0];
                    if group_name == "sudo" || group_name == "wheel" || group_name == "root" {
                        for user in parts[3].split(',') {
                            if !user.is_empty() {
                                admin_users.insert(user.to_string());
                            }
                        }
                    }
                }
            }
        }

        if let Ok(content) = std::fs::read_to_string("/etc/passwd") {
            for line in content.lines() {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 7 {
                    let name = parts[0];
                    let uid: u32 = parts[2].parse().unwrap_or(0);
                    let gecos = parts[4];
                    let shell = parts[6];

                    let is_admin = uid == 0 || admin_users.contains(name);
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

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}
