pub struct LocalAccountEnumerator;

impl LocalAccountEnumerator {
    pub async fn enumerate() -> String {
        #[cfg(target_os = "windows")]
        {
            // 原生 netapi32 枚举（无子进程——进程面收敛二期，
            // powershell.exe / wmic / net 子进程已全部移除）
            Self::enumerate_native()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Self::enumerate_linux()
        }
    }

    /// NetUserEnum + NetLocalGroupGetMembers（netapi32，locale-independent）。
    #[cfg(target_os = "windows")]
    fn enumerate_native() -> String {
        use windows::Win32::NetworkManagement::NetManagement::*;

        // 1) 管理员组成员：well-known SID S-1-5-32-544 → 本地化组名 → 成员
        let mut admins = std::collections::HashSet::new();
        if let Some(group_name) = localized_group_name("S-1-5-32-544") {
            if let Some(members) = local_group_members(&group_name) {
                for m in members {
                    // domainandname 形如 "HOST\user" 或 "user"
                    let name = m.rsplit('\\').next().unwrap_or(&m).to_lowercase();
                    if !name.is_empty() {
                        admins.insert(name);
                    }
                }
            }
        }

        // 2) NetUserEnum level 2 枚举本地用户（FILTER_NORMAL_ACCOUNT）
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
                    let is_admin = admins.contains(&name.to_lowercase());
                    let groups = if is_admin {
                        r#"["Administrators"]"#
                    } else {
                        "[]"
                    };
                    let sid = user_sid(&name);

                    accounts.push(format!(
                        r#"{{"Name":"{}","FullName":"{}","Description":"{}","Enabled":{},"isAdmin":{},"sidValue":"{}","groups":{},"PasswordRequired":false,"UserMayChangePassword":false,"LastLogon":null,"AccountExpires":null,"PasswordLastSet":null,"PasswordExpires":null,"ObjectClass":"User","PrincipalSource":"Local"}}"#,
                        escape(&name),
                        escape(&full_name),
                        escape(&comment),
                        enabled,
                        is_admin,
                        escape(&sid),
                        groups
                    ));
                }
            }
            let _ = NetApiBufferFree(Some(buf as *const core::ffi::c_void));
        }

        format!(r#"{{"accounts":[{}]}}"#, accounts.join(","))
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

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn native_enumeration_returns_accounts() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let out = rt.block_on(LocalAccountEnumerator::enumerate());
        assert!(out.contains("\"accounts\""), "bad output: {out}");
        // 至少应包含当前用户
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

// ── netapi32 原生辅助（无子进程）───────────────────────────────────────

/// 把 well-known SID 字符串解析为 PSID。
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

/// 通过 LookupAccountSidW 获取本地化组名（"Administrators" / "管理员" 等）。
#[cfg(target_os = "windows")]
fn localized_group_name(sid_str: &str) -> Option<String> {
    use windows::Win32::Security::{LookupAccountSidW, SID_NAME_USE};

    let sid = parse_sid(sid_str)?;
    unsafe {
        let mut name_len: u32 = 0;
        let mut domain_len: u32 = 0;
        let mut use_type = SID_NAME_USE(0);

        // 第一次调用获取所需长度
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

/// NetLocalGroupGetMembers 枚举本地组成员（level 2，domainandname）。
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

/// NetUserGetInfoW(level 23) → ConvertSidToStringSidW 获取账户 SID 字符串。
#[cfg(target_os = "windows")]
fn user_sid(username: &str) -> String {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::NetworkManagement::NetManagement::*;
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_core::PCWSTR;

    unsafe {
        let mut buf: *mut u8 = std::ptr::null_mut();
        let name_pcwstr = PCWSTR(
            username
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<u16>>()
                .as_ptr(),
        );

        let status = NetUserGetInfo(None, name_pcwstr, 23, &mut buf);
        if status != 0 || buf.is_null() {
            return String::new();
        }
        let info = &*(buf as *const USER_INFO_23);
        let mut out: windows_core::PWSTR = windows_core::PWSTR::null();
        let sid = info.usri23_user_sid;
        let sid_str = if ConvertSidToStringSidW(sid, &mut out).is_ok() && !out.is_null() {
            let len = (0..)
                .take_while(|&i| !out.0.add(i).is_null() && *out.0.add(i) != 0)
                .count();
            String::from_utf16_lossy(std::slice::from_raw_parts(out.0, len))
        } else {
            String::new()
        };
        if !out.is_null() {
            let _ = LocalFree(windows::Win32::Foundation::HLOCAL(
                out.0 as *mut core::ffi::c_void,
            ));
        }
        let _ = NetApiBufferFree(Some(buf as *const core::ffi::c_void));
        sid_str
    }
}
