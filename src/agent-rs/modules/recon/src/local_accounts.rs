pub struct LocalAccountEnumerator;

impl LocalAccountEnumerator {
    pub async fn enumerate() -> String {
        #[cfg(target_os = "windows")]
        {
            Self::enumerate_native()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Self::enumerate_linux()
        }
    }

    #[cfg(target_os = "windows")]
    fn enumerate_native() -> String {
        use windows::Win32::NetworkManagement::NetManagement::*;

        let mut admins = std::collections::HashSet::new();
        if let Some(group_name) = localized_group_name("S-1-5-32-544") {
            if let Some(members) = local_group_members(&group_name) {
                for m in members {
                    let name = m.rsplit('\\').next().unwrap_or(&m).to_lowercase();
                    if !name.is_empty() {
                        admins.insert(name);
                    }
                }
            }
        }

        let mut accounts = Vec::new();
        unsafe {
            let mut buf: *mut u8 = std::ptr::null_mut();
            let mut read: u32 = 0;
            let mut total: u32 = 0;
            let mut resume: u32 = 0;
            let status = NetUserEnum(
                None,
                2,
                FILTER_NORMAL_ACCOUNT,
                &mut buf,
                u32::MAX,
                &mut read,
                &mut total,
                Some(&mut resume),
            );
            if status == 0 && !buf.is_null() {
                let entries = std::slice::from_raw_parts(buf as *const USER_INFO_2, read as usize);
                for e in entries {
                    let name = e.usri2_name.to_string().unwrap_or_default();
                    if name.is_empty() {
                        continue;
                    }
                    let full_name = e.usri2_full_name.to_string().unwrap_or_default();
                    let comment = e.usri2_comment.to_string().unwrap_or_default();
                    let enabled = (e.usri2_flags.0 & UF_ACCOUNTDISABLE.0) == 0;
                    let passwd_notreqd = (e.usri2_flags.0 & UF_PASSWD_NOTREQD.0) != 0;
                    let is_admin = admins.contains(&name.to_lowercase());
                    let groups = if is_admin {
                        r#"["Administrators"]"#
                    } else {
                        "[]"
                    };

                    let last_logon = win_time(e.usri2_last_logon);
                    let acct_expires = if e.usri2_acct_expires == 0 {
                        "null".to_string()
                    } else {
                        win_time(e.usri2_acct_expires)
                    };

                    accounts.push(format!(
                        r#"{{"Name":"{}","FullName":"{}","Description":"{}","Enabled":{},"isAdmin":{},"sidValue":"","groups":{},"PasswordRequired":{},"UserMayChangePassword":true,"LastLogon":{},"AccountExpires":{},"PasswordLastSet":null,"PasswordExpires":null,"ObjectClass":"User","PrincipalSource":"Local","numLogons":{},"badPasswordCount":{},"passwordNotRequired":{}}}"#,
                        escape(&name),
                        escape(&full_name),
                        escape(&comment),
                        enabled,
                        is_admin,
                        groups,
                        !passwd_notreqd,
                        last_logon,
                        acct_expires,
                        e.usri2_num_logons,
                        e.usri2_bad_pw_count,
                        passwd_notreqd
                    ));
                }
            }
            let _ = NetApiBufferFree(Some(buf as *const core::ffi::c_void));
        }

        let mut out = format!(r#"{{"accounts":[{}]}}"#, accounts.join(","));
        sort_accounts(&mut out);
        out
    }

    #[cfg(not(target_os = "windows"))]
    fn enumerate_linux() -> String {
        let mut accounts = Vec::new();
        let mut admin_users = std::collections::HashSet::new();

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

        let shadow = std::fs::read_to_string("/etc/shadow").ok();
        let mut shadow_map: std::collections::HashMap<String, (bool, bool, bool)> =
            std::collections::HashMap::new();
        // (locked, has_password, password_not_required)
        if let Some(content) = shadow {
            for line in content.lines() {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() < 2 || parts[0].is_empty() {
                    continue;
                }
                let pw = parts[1];
                let locked = pw.starts_with('!') || pw.starts_with('*') || pw.is_empty();
                let has_password = !pw.is_empty() && !pw.starts_with('!') && pw != "*";
                shadow_map.insert(
                    parts[0].to_string(),
                    (locked, has_password, !has_password && !locked),
                );
            }
        }

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

                    let is_admin = uid == 0 || admin_users.contains(name);

                    let (enabled, password_required) = match shadow_map.get(name) {
                        Some((locked, has_password, _)) => (!locked, *has_password),
                        None => (shell != "/usr/sbin/nologin" && shell != "/bin/false", true),
                    };
                    let full_name = gecos.split(',').next().unwrap_or("");

                    accounts.push(format!(
                        r#"{{"Name":"{}","FullName":"{}","Description":"","Enabled":{},"isAdmin":{},"sidValue":"{}","groups":[{}],"PasswordRequired":{},"UserMayChangePassword":true,"LastLogon":null,"AccountExpires":null,"PasswordLastSet":null,"PasswordExpires":null,"ObjectClass":"User","PrincipalSource":"Local","uid":{},"gid":{},"home":"{}","shell":"{}"}}"#,
                        escape(name),
                        escape(full_name),
                        enabled,
                        is_admin,
                        escape(&format!("S-1-0-{}", uid)),
                        if is_admin { "\"Administrators\"" } else { "" },
                        password_required,
                        uid,
                        gid,
                        escape(home),
                        escape(shell)
                    ));
                }
            }
        }

        let mut out = format!(r#"{{"accounts":[{}]}}"#, accounts.join(","));
        sort_accounts(&mut out);
        out
    }
}

fn sort_accounts(json: &mut String) {
    if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(json) {
        if let Some(arr) = v.get_mut("accounts").and_then(|a| a.as_array_mut()) {
            arr.sort_by(|a, b| {
                let admin_a = a.get("isAdmin").and_then(|x| x.as_bool()).unwrap_or(false);
                let admin_b = b.get("isAdmin").and_then(|x| x.as_bool()).unwrap_or(false);
                admin_b.cmp(&admin_a).then_with(|| {
                    a.get("Name")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_lowercase()
                        .cmp(
                            &b.get("Name")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_lowercase(),
                        )
                })
            });
        }
        *json = v.to_string();
    }
}

#[cfg(target_os = "windows")]
fn win_time(secs: u32) -> String {
    if secs == 0 || secs == u32::MAX {
        return "null".to_string();
    }
    let ms = (secs as i64) * 1000;
    format!(r#""/Date({})/""#, ms)
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn native_enumeration_returns_accounts() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let out = rt.block_on(LocalAccountEnumerator::enumerate());
        assert!(out.contains("\"accounts\""), "bad output: {out}");
        let user = std::env::var("USERNAME").unwrap_or_default().to_lowercase();
        if !user.is_empty() {
            assert!(
                out.to_lowercase().contains(&user),
                "current user {user} not found in: {}",
                &out[..out.len().min(2000)]
            );
        }
    }

    #[test]
    fn localized_admin_group_resolves() {
        let name = localized_group_name("S-1-5-32-544");
        assert!(name.is_some(), "Administrators group name not resolved");
    }
}

#[cfg(target_os = "windows")]
fn parse_sid(sid_str: &str) -> Option<windows::Win32::Security::PSID> {
    use windows::Win32::Security::Authorization::ConvertStringSidToSidW;
    use windows_core::PCWSTR;

    let wide: Vec<u16> = sid_str.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut sid: windows::Win32::Security::PSID =
            windows::Win32::Security::PSID(std::ptr::null_mut());
        if ConvertStringSidToSidW(PCWSTR(wide.as_ptr()), &mut sid).is_ok() && !sid.0.is_null() {
            Some(sid)
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn localized_group_name(sid_str: &str) -> Option<String> {
    use windows::Win32::Security::{LookupAccountSidW, SID_NAME_USE};

    let sid = parse_sid(sid_str)?;
    unsafe {
        let mut name_len: u32 = 0;
        let mut domain_len: u32 = 0;
        let mut use_type = SID_NAME_USE(0);

        let _ = LookupAccountSidW(
            None,
            sid,
            windows_core::PWSTR::null(),
            &mut name_len,
            windows_core::PWSTR::null(),
            &mut domain_len,
            &mut use_type,
        );

        if name_len == 0 {
            return None;
        }
        let mut name_buf = vec![0u16; name_len as usize];
        let mut domain_buf = vec![0u16; domain_len as usize];
        let name_pwstr = windows_core::PWSTR(name_buf.as_mut_ptr());
        let domain_pwstr = windows_core::PWSTR(domain_buf.as_mut_ptr());

        if LookupAccountSidW(
            None,
            sid,
            name_pwstr,
            &mut name_len,
            domain_pwstr,
            &mut domain_len,
            &mut use_type,
        )
        .is_ok()
        {
            let name = String::from_utf16_lossy(&name_buf)
                .trim_end_matches('\0')
                .to_string();
            return if name.is_empty() { None } else { Some(name) };
        }
        None
    }
}

#[cfg(target_os = "windows")]
fn local_group_members(group_name: &str) -> Option<Vec<String>> {
    use windows::Win32::NetworkManagement::NetManagement::*;
    use windows_core::PCWSTR;

    unsafe {
        let mut buf: *mut u8 = std::ptr::null_mut();
        let mut read: u32 = 0;
        let mut total: u32 = 0;
        let mut resume: usize = 0;
        let name_pcwstr = PCWSTR(
            group_name
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<u16>>()
                .as_ptr(),
        );

        let status = NetLocalGroupGetMembers(
            None,
            name_pcwstr,
            2,
            &mut buf,
            u32::MAX,
            &mut read,
            &mut total,
            Some(&mut resume),
        );
        if status != 0 || buf.is_null() {
            return None;
        }

        let entries =
            std::slice::from_raw_parts(buf as *const LOCALGROUP_MEMBERS_INFO_2, read as usize);
        let mut members = Vec::new();
        for e in entries {
            if let Ok(name) = e.lgrmi2_domainandname.to_string() {
                if !name.is_empty() {
                    members.push(name);
                }
            }
        }
        let _ = NetApiBufferFree(Some(buf as *const core::ffi::c_void));
        Some(members)
    }
}
