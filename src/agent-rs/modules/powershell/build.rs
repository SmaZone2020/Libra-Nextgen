//! 构建时用本机 .NET Framework csc.exe 编译 PsInlineStub.cs → psinline_stub.dll。
//! 产物由 lib.rs 通过 include_bytes! 嵌入模块，运行时在内存中加载（无磁盘文件）。
//!
//! csc 路径候选（64 位优先，回退 32 位）：
//!   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
//!   C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe
//! 引用：mscorlib（默认）、System、System.Core（命名管道）、GAC 中的
//! System.Management.Automation（Windows PowerShell 5.1 自带，随系统安装）。

use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=stub/PsInlineStub.cs");

    #[cfg(target_os = "windows")]
    {
        let csc_candidates = [
            r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
            r"C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe",
        ];
        let csc = csc_candidates.iter().find(|p| std::path::Path::new(p).exists());
        let csc = match csc {
            Some(p) => p,
            None => {
                // 非 Windows 或缺少 .NET Framework：构建失败并给出清晰提示。
                // （在 Windows 上 S.M.A. 是 PowerShell 5.1 自带组件，理应存在）
                if cfg!(target_os = "windows") {
                    panic!("csc.exe not found — .NET Framework 4.x required to build the PowerShell inline stub");
                }
                return;
            }
        };

        let fw_dir = std::path::Path::new(csc).parent().unwrap();
        let gac_sma = r"C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Management.Automation";
        let sma = find_sma_in_gac(gac_sma)
            .unwrap_or_else(|| panic!("System.Management.Automation not found in GAC ({gac_sma})"));

        let out_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("stub");
        std::fs::create_dir_all(&out_dir).expect("create stub dir");
        let out_dll = out_dir.join("psinline_stub.dll");
        let src = out_dir.join("PsInlineStub.cs");

        let status = Command::new(csc)
            .arg("/nologo")
            .arg("/target:library")
            .arg("/optimize+")
            .arg(format!("/out:{}", out_dll.display()))
            .arg(format!("/r:{}", fw_dir.join("System.dll").display()))
            .arg(format!("/r:{}", fw_dir.join("System.Core.dll").display()))
            .arg(format!("/r:{sma}"))
            .arg(&src)
            .status()
            .expect("failed to run csc.exe");

        if !status.success() {
            panic!("csc.exe failed to compile PsInlineStub.cs (exit {status})");
        }
        println!("cargo:rerun-if-changed={}", out_dll.display());
        println!("cargo:rustc-env=PSINLINE_STUB_DLL={}", out_dll.display());
    }
}

#[cfg(target_os = "windows")]
fn find_sma_in_gac(root: &str) -> Option<String> {
    // GAC 布局：...\GAC_MSIL\System.Management.Automation\<version>__<token>\System.Management.Automation.dll
    let base = std::path::Path::new(root);
    if !base.is_dir() {
        return None;
    }
    for entry in std::fs::read_dir(base).ok()? {
        let entry = entry.ok()?;
        if !entry.path().is_dir() {
            continue;
        }
        let dll = entry.path().join("System.Management.Automation.dll");
        if dll.exists() {
            return Some(dll.to_string_lossy().to_string());
        }
    }
    None
}
