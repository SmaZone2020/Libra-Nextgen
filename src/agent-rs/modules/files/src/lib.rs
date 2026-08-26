//! Files cloud module — directory listing, read/write, move/copy, archive ops.
#![allow(non_snake_case)]
#![allow(clippy::upper_case_acronyms)]

mod file_ops;

use serde_json::Value;

/// libra-load ABI entry point.
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("files", "\0").as_ptr() as *const u8
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
    let result = dispatch(&input_json);
    write_output(&result, output, output_cap)
}

fn dispatch(input: &str) -> String {
    let v: Value = serde_json::from_str(input).unwrap_or(Value::Object(Default::default()));
    let op = v.get("op").and_then(|o| o.as_str()).unwrap_or("");
    let path = v.get("path").and_then(|p| p.as_str()).unwrap_or("");

    match op {
        "list" => {
            let offset = v.get("offset").and_then(|o| o.as_u64()).unwrap_or(0) as usize;
            let limit = v.get("limit").and_then(|l| l.as_u64()).unwrap_or(200) as usize;
            file_ops::FileOps::list_directory_paged(path, offset, limit)
        }
        "drives" => {
            let drives = libra_platform::get_executor().get_drives();
            let escaped: Vec<String> = drives
                .iter()
                .map(|d| format!(r#""{}""#, d.replace('\\', "\\\\")))
                .collect();
            format!(r#"{{"drives":[{}]}}"#, escaped.join(","))
        }
        "read" => file_ops::FileOps::read_file(path),
        "download" => {
            let offset = v.get("offset").and_then(|o| o.as_u64()).unwrap_or(0);
            let chunk_size = v
                .get("chunkSize")
                .and_then(|c| c.as_u64())
                .unwrap_or(2 * 1024 * 1024) as usize;
            file_ops::FileOps::download_chunk(path, offset, chunk_size)
        }
        "write" => {
            let data = v.get("data").and_then(|d| d.as_str()).unwrap_or("");
            file_ops::FileOps::write_file(path, data)
        }
        "open" => file_ops::FileOps::open_file(path),
        "delete" => file_ops::FileOps::delete(path),
        "mkdir" => file_ops::FileOps::create_directory(path),
        "rename" => {
            let new_name = v.get("newName").and_then(|n| n.as_str()).unwrap_or("");
            file_ops::FileOps::rename(path, new_name)
        }
        "move" => {
            let dest = v.get("destination").and_then(|d| d.as_str()).unwrap_or("");
            file_ops::FileOps::move_path(path, dest)
        }
        "copy" => {
            let dest = v.get("destination").and_then(|d| d.as_str()).unwrap_or("");
            file_ops::FileOps::copy(path, dest)
        }
        "compress" => file_ops::FileOps::compress(path),
        "decompress" => {
            let dest = v
                .get("destination")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string());
            file_ops::FileOps::decompress(path, dest.as_deref())
        }
        "shortcut" => file_ops::FileOps::create_shortcut(path),
        "archive_list" => file_ops::FileOps::list_archive(path),
        _ => format!(r#"{{"error":"unknown files op '{}'"}}"#, op),
    }
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
