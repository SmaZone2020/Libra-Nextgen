//! Kerberos ticket cache 查询（klist）：通过 LSA 接口枚举当前会话的 TGT/服务票据。
//! ptt/purge 后续补充。

#![allow(non_snake_case)]

const KERB_QUERY_TKT_CACHE_MESSAGE: u32 = 0x22;

#[link(name = "secur32")]
extern "system" {
    fn LsaConnectUntrusted(handle: *mut usize) -> i32;
    fn LsaLookupAuthenticationPackage(handle: usize, name: *const u16, package_id: *mut i32)
        -> i32;
    fn LsaCallAuthenticationPackage(
        handle: usize,
        package_id: i32,
        input: *mut u8,
        input_len: u32,
        output: *mut *mut u8,
        output_len: *mut u32,
        return_status: *mut i32,
    ) -> i32;
    fn LsaFreeReturnBuffer(buffer: *mut u8) -> i32;
}

#[repr(C)]
#[derive(Clone, Copy)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}

#[repr(C)]
struct KerbQueryTicketCacheRequest {
    message_type: u32,
    logon_id: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct KerbTicketCacheInfo {
    server_name: UnicodeString,
    realm_name: UnicodeString,
    start_time: i64,
    end_time: i64,
    renew_time: i64,
    encryption_type: i32,
    ticket_flags: u32,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 读 UNICODE_STRING。
unsafe fn read_unicode(s: &UnicodeString) -> String {
    if s.buffer.is_null() || s.length == 0 {
        return String::new();
    }
    let len = (s.length as usize) / 2;
    String::from_utf16_lossy(std::slice::from_raw_parts(s.buffer, len))
}

/// 查询 Kerberos ticket 缓存，返回 JSON 列表。
pub fn klist() -> String {
    unsafe {
        let mut handle = 0usize;
        if LsaConnectUntrusted(&mut handle) != 0 {
            return r#"{"success":false,"error":"LsaConnectUntrusted failed"}"#.to_string();
        }

        let mut package_id = 0i32;
        let name = wide("Kerberos");
        if LsaLookupAuthenticationPackage(handle, name.as_ptr(), &mut package_id) != 0 {
            return r#"{"success":false,"error":"Kerberos auth package not found"}"#.to_string();
        }

        let req = KerbQueryTicketCacheRequest {
            message_type: KERB_QUERY_TKT_CACHE_MESSAGE,
            logon_id: 0,
        };
        let mut output: *mut u8 = std::ptr::null_mut();
        let mut output_len = 0u32;
        let mut return_status = 0i32;

        let status = LsaCallAuthenticationPackage(
            handle,
            package_id,
            &req as *const KerbQueryTicketCacheRequest as *mut u8,
            std::mem::size_of::<KerbQueryTicketCacheRequest>() as u32,
            &mut output,
            &mut output_len,
            &mut return_status,
        );

        if status != 0 || return_status != 0 || output.is_null() {
            return r#"{"success":false,"error":"LsaCallAuthenticationPackage failed"}"#
                .to_string();
        }

        // 响应布局：{ message_type: u32, count: u32, tickets: [...] }
        let count = *(output.add(4) as *const u32) as usize;
        let tickets = output.add(8) as *const KerbTicketCacheInfo;

        let mut out = Vec::new();
        for i in 0..count {
            let t = &*tickets.add(i);
            let server = read_unicode(&t.server_name);
            let realm = read_unicode(&t.realm_name);
            out.push(serde_json::json!({
                "server": server,
                "realm": realm,
                "start": t.start_time,
                "end": t.end_time,
                "encryption": t.encryption_type,
                "flags": format!("{:x}", t.ticket_flags),
            }));
        }

        let _ = LsaFreeReturnBuffer(output);
        serde_json::json!({ "success": true, "tickets": out }).to_string()
    }
}
