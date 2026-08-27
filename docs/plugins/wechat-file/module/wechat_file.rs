//! 微信文件插件 — 独立 native 插件（cdylib）。
//!
//! 扫描本机微信（xwechat_files）下所有已登录账号（wxid_*），列出每个账号
//! 的消息文件月份目录（msg\file\<YYYY-MM>）。文件浏览/下载由前端走宿主
//! files 模块完成，本模块只负责账号与月份目录枚举。
//!
//! ABI（libra-load）：
//!   module_name() -> *const u8
//!   module_main(input, input_len, output, output_cap) -> usize

use serde_json::json;

/// 自识别名（必须与插件 meta.json 的 module.name 一致）。
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("wechat_file", "\0").as_ptr() as *const u8
}

/// 入口：input 为 JSON（可空），忽略参数直接扫描微信账号。
#[no_mangle]
pub unsafe extern "system" fn module_main(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_cap: usize,
) -> usize {
    let _ = (input, input_len);
    let result = collect_wechat();
    write_output(&result, output, output_cap)
}

fn collect_wechat() -> String {
    let docs = get_documents_dir();
    let xwechat_dir = format!(r"{}\Tencent Files\xwechat_files", docs);

    let dir = match std::fs::read_dir(&xwechat_dir) {
        Ok(d) => d,
        Err(_) => return json!({ "accounts": [] }).to_string(),
    };

    let mut accounts = Vec::new();
    for entry in dir.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("wxid_") {
            continue;
        }

        let file_dir = format!(r"{}\msg\file", entry.path().to_string_lossy());
        let mut month_dirs = Vec::new();
        if let Ok(sub_entries) = std::fs::read_dir(&file_dir) {
            for sub in sub_entries.filter_map(|e| e.ok()) {
                let sub_name = sub.file_name().to_string_lossy().to_string();
                if is_year_month(&sub_name) {
                    month_dirs.push(sub_name);
                }
            }
            month_dirs.sort_by(|a, b| b.cmp(a)); // newest first
        }

        accounts.push(json!({
            "wxid": name,
            "path": entry.path().to_string_lossy().to_string(),
            "fileDirs": month_dirs,
        }));
    }

    json!({ "accounts": accounts }).to_string()
}

fn get_documents_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .map(|p| format!(r"{}\Documents", p))
            .unwrap_or_else(|_| r"C:\Users\Default\Documents".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").unwrap_or_else(|_| "/home".to_string())
    }
}

fn is_year_month(s: &str) -> bool {
    if s.len() != 7 {
        return false;
    }
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 2 {
        return false;
    }
    parts[0].len() == 4
        && parts[0].chars().all(|c| c.is_ascii_digit())
        && parts[1].len() == 2
        && parts[1].chars().all(|c| c.is_ascii_digit())
}

fn write_output(s: &str, output: *mut u8, output_cap: usize) -> usize {
    let bytes = s.as_bytes();
    let n = bytes.len().min(output_cap);
    if n > 0 && !output.is_null() {
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n);
        }
    }
    n
}
