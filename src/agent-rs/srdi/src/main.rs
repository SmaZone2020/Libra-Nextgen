//! srdi CLI — validates a PE DLL for reflective loading compatibility.
//!
//! Usage: srdi <input.dll> <export_name> [output_path]
//!
//! If output_path is omitted, writes to <input>.bin

use std::{env, fs, path::PathBuf, process};

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 3 {
        eprintln!("Usage: srdi <input.dll> <export_name> [output_path]");
        eprintln!("  Validates DLL and copies it for reflective loading.");
        process::exit(1);
    }

    let input_path = &args[1];
    let export_name = &args[2];
    let output_path = if args.len() > 3 {
        PathBuf::from(&args[3])
    } else {
        let mut p = PathBuf::from(input_path);
        p.set_extension("bin");
        p
    };

    eprintln!("[srdi] Input: {}", input_path);
    eprintln!("[srdi] Export: {}", export_name);
    eprintln!("[srdi] Output: {}", output_path.display());

    let dll_bytes = match fs::read(input_path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[srdi] ERROR: Failed to read input: {}", e);
            process::exit(1);
        }
    };

    eprintln!("[srdi] DLL size: {} bytes", dll_bytes.len());

    let output = match srdi::validate_and_package(&dll_bytes, export_name) {
        Ok(out) => out,
        Err(e) => {
            eprintln!("[srdi] ERROR: Validation failed: {}", e);
            process::exit(1);
        }
    };

    let hash = srdi::hash_export_name(export_name);
    eprintln!("[srdi] Export '{}' found (hash=0x{:08X})", export_name, hash);
    eprintln!("[srdi] Output size: {} bytes", output.len());

    if let Err(e) = fs::write(&output_path, &output) {
        eprintln!("[srdi] ERROR: Failed to write output: {}", e);
        process::exit(1);
    }

    eprintln!("[srdi] Done.");
}
