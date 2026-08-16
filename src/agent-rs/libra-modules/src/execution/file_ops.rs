use std::path::{Path, PathBuf};
use base64::Engine;

pub struct FileOps;

impl FileOps {
    pub fn list_directory(path: &str) -> String {
        let dir = match std::fs::read_dir(path) {
            Ok(d) => d,
            Err(_) => return r#"{"error":"Directory not found"}"#.to_string(),
        };

        let entries: Vec<String> = dir
            .filter_map(|e| e.ok())
            .map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                let metadata = entry.metadata().ok();
                let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified = metadata
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| {
                        let secs = d.as_secs();
                        format_unix_timestamp(secs)
                    })
                    .unwrap_or_default();

                format!(
                    r#"{{"name":"{}","type":"{}","size":{},"modified":"{}","attributes":""}}"#,
                    escape(&name),
                    if is_dir { "dir" } else { "file" },
                    size,
                    escape(&modified),
                )
            })
            .collect();

        format!(
            r#"{{"path":"{}","entries":[{}]}}"#,
            escape(path),
            entries.join(",")
        )
    }

    pub fn read_file(path: &str) -> String {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => return r#"{"error":"File not found"}"#.to_string(),
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        format!(
            r#"{{"path":"{}","size":{},"content":"{}"}}"#,
            escape(path),
            bytes.len(),
            escape(&b64)
        )
    }

    /// List the entries of a ZIP archive without extracting it.
    pub fn list_archive(path: &str) -> String {
        let data = match std::fs::read(path) {
            Ok(d) => d,
            Err(e) => return format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
        };

        let mut entries: Vec<String> = Vec::new();
        let mut pos = 0usize;
        while pos + 30 <= data.len() {
            let sig = u32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]);
            if sig == 0x02014b50 || sig == 0x06054b50 {
                break; // Central directory or EOCD
            }
            if sig != 0x04034b50 {
                pos += 1;
                continue;
            }

            let name_len = u16::from_le_bytes([data[pos + 26], data[pos + 27]]) as usize;
            let extra_len = u16::from_le_bytes([data[pos + 28], data[pos + 29]]) as usize;
            let comp_size =
                u32::from_le_bytes([data[pos + 18], data[pos + 19], data[pos + 20], data[pos + 21]]) as usize;
            let uncomp_size =
                u32::from_le_bytes([data[pos + 22], data[pos + 23], data[pos + 24], data[pos + 25]]) as usize;

            let header_end = pos + 30 + name_len + extra_len;
            if header_end > data.len() {
                break;
            }

            let name = String::from_utf8_lossy(&data[pos + 30..pos + 30 + name_len]).to_string();
            let is_dir = name.ends_with('/');
            entries.push(format!(
                r#"{{"name":"{}","type":"{}","size":{},"modified":""}}"#,
                escape(name.trim_end_matches('/')),
                if is_dir { "dir" } else { "file" },
                uncomp_size,
            ));

            pos = header_end + comp_size;
        }

        format!(
            r#"{{"path":"{}","entries":[{}]}}"#,
            escape(path),
            entries.join(",")
        )
    }

    pub fn write_file(path: &str, base64_content: &str) -> String {
        let bytes = match base64::engine::general_purpose::STANDARD.decode(base64_content) {
            Ok(b) => b,
            Err(e) => return format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
        };
        match std::fs::write(path, &bytes) {
            Ok(_) => format!(
                r#"{{"path":"{}","size":{},"status":"written"}}"#,
                escape(path),
                bytes.len()
            ),
            Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
        }
    }

    pub fn delete(path: &str) -> String {
        let p = Path::new(path);
        if p.is_file() {
            match std::fs::remove_file(p) {
                Ok(_) => format!(r#"{{"path":"{}","status":"deleted"}}"#, escape(path)),
                Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
            }
        } else if p.is_dir() {
            match std::fs::remove_dir_all(p) {
                Ok(_) => format!(r#"{{"path":"{}","status":"deleted"}}"#, escape(path)),
                Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
            }
        } else {
            r#"{"error":"Path not found"}"#.to_string()
        }
    }

    pub fn create_directory(path: &str) -> String {
        match std::fs::create_dir_all(path) {
            Ok(_) => format!(r#"{{"path":"{}","status":"created"}}"#, escape(path)),
            Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
        }
    }

    pub fn rename(path: &str, new_name: &str) -> String {
        let p = Path::new(path);
        let parent = p.parent().unwrap_or(Path::new(""));
        let dest = parent.join(new_name);

        if p.exists() {
            match std::fs::rename(p, &dest) {
                Ok(_) => format!(
                    r#"{{"path":"{}","status":"renamed"}}"#,
                    escape(&dest.to_string_lossy())
                ),
                Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
            }
        } else {
            r#"{"error":"Path not found"}"#.to_string()
        }
    }

    pub fn move_path(source: &str, destination: &str) -> String {
        let src = Path::new(source);
        let dst = Path::new(destination);
        let dest = if dst.is_dir() {
            dst.join(src.file_name().unwrap_or_default())
        } else {
            dst.to_path_buf()
        };

        if !src.exists() {
            return r#"{"error":"Source path not found"}"#.to_string();
        }

        match std::fs::rename(src, &dest) {
            Ok(_) => format!(
                r#"{{"path":"{}","status":"moved"}}"#,
                escape(&dest.to_string_lossy())
            ),
            Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
        }
    }

    pub fn copy(source: &str, destination: &str) -> String {
        let src = Path::new(source);
        let dst = Path::new(destination);
        let dest = if dst.is_dir() {
            dst.join(src.file_name().unwrap_or_default())
        } else {
            dst.to_path_buf()
        };

        if !src.exists() {
            return r#"{"error":"Source path not found"}"#.to_string();
        }

        if src.is_file() {
            match std::fs::copy(src, &dest) {
                Ok(_) => format!(
                    r#"{{"path":"{}","status":"copied"}}"#,
                    escape(&dest.to_string_lossy())
                ),
                Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
            }
        } else if src.is_dir() {
            match copy_dir_recursive(src, &dest) {
                Ok(_) => format!(
                    r#"{{"path":"{}","status":"copied"}}"#,
                    escape(&dest.to_string_lossy())
                ),
                Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
            }
        } else {
            r#"{"error":"Source path not found"}"#.to_string()
        }
    }

    pub fn compress(path: &str) -> String {
        let p = Path::new(path);
        let zip_path = format!("{}.zip", p.to_string_lossy().trim_end_matches(['\\', '/']));

        if !p.exists() {
            return r#"{"error":"Path not found"}"#.to_string();
        }

        // Simple ZIP creation using standard library + raw deflate
        // We create a basic ZIP file with store (no compression) for simplicity
        let files = if p.is_dir() {
            collect_files(p).unwrap_or_default()
        } else {
            vec![(p.to_path_buf(), p.file_name().unwrap_or_default().to_string_lossy().to_string())]
        };

        match create_zip(&zip_path, p, &files) {
            Ok(size) => format!(
                r#"{{"path":"{}","size":{},"status":"compressed"}}"#,
                escape(&zip_path), size
            ),
            Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
        }
    }

    pub fn decompress(zip_path: &str, destination: Option<&str>) -> String {
        let src = Path::new(zip_path);
        if !src.exists() {
            return r#"{"error":"Archive not found"}"#.to_string();
        }

        let dest = match destination {
            Some(d) => PathBuf::from(d),
            None => {
                let parent = src.parent().unwrap_or(Path::new(""));
                let stem = src.file_stem().unwrap_or_default();
                parent.join(stem)
            }
        };

        // Simple ZIP extraction (store-only for now)
        match extract_zip(src, &dest) {
            Ok(_) => format!(
                r#"{{"path":"{}","status":"decompressed"}}"#,
                escape(&dest.to_string_lossy())
            ),
            Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
        }
    }

    pub fn create_shortcut(target_path: &str) -> String {
        let target = Path::new(target_path);
        if !target.exists() {
            return r#"{"error":"Target path not found"}"#.to_string();
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let lnk_path = format!("{}.lnk", target_path);
            let script = format!(
                "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{}'); $s.TargetPath = '{}'; $s.Save()",
                lnk_path.replace('\'', "''"),
                target_path.replace('\'', "''")
            );
            let result = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &script])
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();

            match result {
                Ok(s) if s.success() => format!(
                    r#"{{"path":"{}","status":"shortcut_created"}}"#,
                    escape(&lnk_path)
                ),
                Ok(s) => format!(
                    r#"{{"error":"PowerShell exited with code {}"}}"#, 
                    s.code().unwrap_or(-1)
                ),
                Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let link_path = format!("{}.link", target_path);
            match std::os::unix::fs::symlink(target, &link_path) {
                Ok(_) => format!(
                    r#"{{"path":"{}","status":"shortcut_created"}}"#,
                    escape(&link_path)
                ),
                Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
            }
        }
    }
}

// ── ZIP helpers ──────────────────────────────────────────────────────

fn collect_files(dir: &Path) -> Result<Vec<(PathBuf, String)>, std::io::Error> {
    let mut files = Vec::new();
    let base = dir.to_path_buf();
    collect_files_recursive(&base, &base, &mut files)?;
    Ok(files)
}

fn collect_files_recursive(
    base: &Path,
    current: &Path,
    files: &mut Vec<(PathBuf, String)>,
) -> Result<(), std::io::Error> {
    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let rel = path.strip_prefix(base).unwrap_or(&path).to_string_lossy().to_string();

        if path.is_file() {
            files.push((path, rel));
        } else if path.is_dir() {
            files.push((path.clone(), format!("{}/", rel)));
            collect_files_recursive(base, &path, files)?;
        }
    }
    Ok(())
}

fn create_zip(zip_path: &str, _base: &Path, files: &[(PathBuf, String)]) -> Result<u64, String> {
    use std::io::Write;
    let file = std::fs::File::create(zip_path).map_err(|e| e.to_string())?;
    let mut zip = std::io::BufWriter::new(file);
    let mut offset = 0u64;
    let mut central_dir = Vec::new();

    for (path, name) in files {
        if name.ends_with('/') {
            continue; // Skip directory entries in store mode
        }

        let content = std::fs::read(path).map_err(|e| e.to_string())?;
        let crc = crc32(&content);

        // Local file header
        let name_bytes = name.as_bytes();
        zip.write_all(b"PK\03\04").map_err(|e| e.to_string())?; // Signature
        zip.write_all(&20u16.to_le_bytes()).map_err(|e| e.to_string())?; // Version
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?; // Flags
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?; // Compression: store
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?; // Time
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?; // Date
        zip.write_all(&crc.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&(content.len() as u32).to_le_bytes()).map_err(|e| e.to_string())?; // Compressed size
        zip.write_all(&(content.len() as u32).to_le_bytes()).map_err(|e| e.to_string())?; // Uncompressed size
        zip.write_all(&(name_bytes.len() as u16).to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?; // Extra length
        zip.write_all(name_bytes).map_err(|e| e.to_string())?;
        zip.write_all(&content).map_err(|e| e.to_string())?;

        // Save for central directory
        central_dir.push((name_bytes, crc, content.len() as u32, offset));
        offset += 30 + name_bytes.len() as u64 + content.len() as u64;
    }

    let cd_offset = offset;

    // Central directory
    for (name_bytes, crc, size, loc_offset) in &central_dir {
        zip.write_all(b"PK\01\02").map_err(|e| e.to_string())?;
        zip.write_all(&20u16.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&20u16.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&crc.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&size.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&size.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&(name_bytes.len() as u16).to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&0u32.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(&loc_offset.to_le_bytes()).map_err(|e| e.to_string())?;
        zip.write_all(name_bytes).map_err(|e| e.to_string())?;
        offset += 46 + name_bytes.len() as u64;
    }

    let cd_size = offset - cd_offset;
    let cd_count = central_dir.len() as u16;

    // End of central directory
    zip.write_all(b"PK\05\06").map_err(|e| e.to_string())?;
    zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?;
    zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?;
    zip.write_all(&cd_count.to_le_bytes()).map_err(|e| e.to_string())?;
    zip.write_all(&cd_count.to_le_bytes()).map_err(|e| e.to_string())?;
    zip.write_all(&(cd_size as u32).to_le_bytes()).map_err(|e| e.to_string())?;
    zip.write_all(&(cd_offset as u32).to_le_bytes()).map_err(|e| e.to_string())?;
    zip.write_all(&0u16.to_le_bytes()).map_err(|e| e.to_string())?;

    zip.flush().map_err(|e| e.to_string())?;

    let meta = std::fs::metadata(zip_path).map_err(|e| e.to_string())?;
    Ok(meta.len())
}

fn extract_zip(src: &Path, dest: &Path) -> Result<(), String> {
    let data = std::fs::read(src).map_err(|e| e.to_string())?;
    let mut pos = 0;

    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;

    while pos + 30 <= data.len() {
        if data[pos..].len() < 4 { break; }
        let sig = u32::from_le_bytes([data[pos], data[pos+1], data[pos+2], data[pos+3]]);
        if sig == 0x02014b50 || sig == 0x06054b50 {
            break; // Central directory or EOCD
        }
        if sig != 0x04034b50 {
            pos += 1;
            continue;
        }

        let name_len = u16::from_le_bytes([data[pos+26], data[pos+27]]) as usize;
        let extra_len = u16::from_le_bytes([data[pos+28], data[pos+29]]) as usize;
        let comp_size = u32::from_le_bytes([data[pos+18], data[pos+19], data[pos+20], data[pos+21]]) as usize;
        let comp_method = u16::from_le_bytes([data[pos+8], data[pos+9]]);

        let header_end = pos + 30 + name_len + extra_len;
        if header_end + comp_size > data.len() { break; }

        let name = String::from_utf8_lossy(&data[pos+30..pos+30+name_len]);
        let content = &data[header_end..header_end + comp_size];

        if comp_method == 0 {
            let out_path = dest.join(&*name);
            let canonical_dest = dest.canonicalize().unwrap_or_else(|_| dest.to_path_buf());
            let canonical_out = out_path.canonicalize().unwrap_or_else(|_| {
                let mut p = out_path.clone();
                while !p.exists() { if !p.pop() { break; } }
                p
            });
            if !canonical_out.starts_with(&canonical_dest) {
                return Err(format!("ZIP entry '{}' attempts path traversal", name));
            }
            if name.ends_with('/') {
                std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::write(&out_path, content).map_err(|e| e.to_string())?;
            }
        }

        pos = header_end + comp_size;
    }
    Ok(())
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest_path = dest.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

fn format_unix_timestamp(secs: u64) -> String {
    if secs == 0 { return String::new(); }
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;
    let mut year = 1970i64;
    let mut remaining_days = days_since_epoch as i64;
    loop {
        let days_in_year = if is_leap(year) { 366 } else { 365 };
        if remaining_days < days_in_year { break; }
        remaining_days -= days_in_year;
        year += 1;
    }
    let days_in_months = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1;
    for &dim in &days_in_months {
        if remaining_days < dim as i64 { break; }
        remaining_days -= dim as i64;
        month += 1;
    }
    let day = remaining_days + 1;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.0000000Z", year, month, day, hours, minutes, seconds)
}

fn is_leap(y: i64) -> bool { y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) }

fn escape(s: &str) -> String {
    libra_common::json_util::escape_json(s)
}
