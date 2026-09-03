//!

#[cfg(target_os = "windows")]
use std::process::Command;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=stub/PsInlineStub.cs");

    // Windows host: compile the stub with csc.exe (.NET Framework 4.x).
    #[cfg(target_os = "windows")]
    {
        let csc_candidates = [
            r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
            r"C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe",
        ];
        let csc = csc_candidates
            .iter()
            .find(|p| std::path::Path::new(p).exists());
        let csc = match csc {
            Some(p) => p,
            None => {
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

        let out_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("stub");
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

    // Non-Windows hosts (e.g. the Docker builder cross-compiling win targets):
    // csc.exe is unavailable, so rely on the committed prebuilt IL stub.
    #[cfg(not(target_os = "windows"))]
    {
        let stub_dll = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("stub")
            .join("psinline_stub.dll");
        if !stub_dll.exists() {
            panic!(
                "missing stub/psinline_stub.dll — regenerate it on a Windows host (csc.exe) \
                 or restore the committed artifact"
            );
        }
        println!("cargo:rerun-if-changed={}", stub_dll.display());
    }
}

#[cfg(target_os = "windows")]
fn find_sma_in_gac(root: &str) -> Option<String> {
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
