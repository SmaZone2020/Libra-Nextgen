//! sRDI build-time tool — validates a PE DLL and packages it for reflective loading.
//!
//! The loader performs the actual in-memory mapping at runtime.
//! This tool ensures the DLL is valid and suitable for manual mapping.

mod stub;

/// Validate a PE DLL and return it packaged for the loader.
///
/// Output format: raw DLL bytes (unchanged).
/// The loader handles manual mapping at runtime using its own Win32 API access.
///
/// This function verifies:
/// - Valid MZ/PE signature
/// - x64 architecture
/// - Target export exists in the export table
pub fn validate_and_package(dll_bytes: &[u8], export_name: &str) -> Result<Vec<u8>, String> {
    if dll_bytes.len() < 64 {
        return Err("DLL too small".into());
    }
    if dll_bytes[0] != 0x4D || dll_bytes[1] != 0x5A {
        return Err("Not a valid PE (MZ signature missing)".into());
    }

    let e_lfanew = u32::from_le_bytes(
        dll_bytes[0x3C..0x40]
            .try_into()
            .map_err(|_| "Failed to read e_lfanew")?,
    ) as usize;

    if e_lfanew + 0x18 > dll_bytes.len() {
        return Err("NT headers out of bounds".into());
    }

    let nt_sig = u32::from_le_bytes(dll_bytes[e_lfanew..e_lfanew + 4].try_into().unwrap());
    if nt_sig != 0x00004550 {
        return Err(format!("Invalid PE signature: 0x{:08X}", nt_sig));
    }

    let machine = u16::from_le_bytes(dll_bytes[e_lfanew + 4..e_lfanew + 6].try_into().unwrap());
    if machine != 0x8664 {
        return Err(format!("Not x64 (machine=0x{:04X})", machine));
    }

    // Verify export exists
    if !has_export(dll_bytes, e_lfanew, export_name)? {
        return Err(format!("Export '{}' not found in DLL", export_name));
    }

    Ok(dll_bytes.to_vec())
}

/// Check if a PE DLL has a specific named export.
fn has_export(dll_bytes: &[u8], nt_offset: usize, target: &str) -> Result<bool, String> {
    // Optional header starts at nt_offset + 0x18
    let opt_offset = nt_offset + 0x18;

    // Number of RVA and sizes at opt_offset + 0x6C (for PE32+)
    let num_dirs = u32::from_le_bytes(
        dll_bytes[opt_offset + 0x6C..opt_offset + 0x70]
            .try_into()
            .unwrap(),
    ) as usize;

    if num_dirs == 0 {
        return Ok(false);
    }

    // Export directory is data_directory[0], starts at opt_offset + 0x70
    let export_rva = u32::from_le_bytes(
        dll_bytes[opt_offset + 0x70..opt_offset + 0x74]
            .try_into()
            .unwrap(),
    ) as usize;
    let export_size = u32::from_le_bytes(
        dll_bytes[opt_offset + 0x74..opt_offset + 0x78]
            .try_into()
            .unwrap(),
    ) as usize;

    if export_rva == 0 || export_size == 0 {
        return Ok(false);
    }

    // Convert RVA to file offset
    let export_file_offset = rva_to_offset(dll_bytes, nt_offset, export_rva)?;

    // Parse export directory
    let num_names = u32::from_le_bytes(
        dll_bytes[export_file_offset + 0x18..export_file_offset + 0x1C]
            .try_into()
            .unwrap(),
    ) as usize;
    let names_rva = u32::from_le_bytes(
        dll_bytes[export_file_offset + 0x20..export_file_offset + 0x24]
            .try_into()
            .unwrap(),
    ) as usize;
    let names_offset = rva_to_offset(dll_bytes, nt_offset, names_rva)?;

    for i in 0..num_names {
        let name_rva = u32::from_le_bytes(
            dll_bytes[names_offset + i * 4..names_offset + i * 4 + 4]
                .try_into()
                .unwrap(),
        ) as usize;
        let name_offset = rva_to_offset(dll_bytes, nt_offset, name_rva)?;

        // Read null-terminated string
        let name_end = dll_bytes[name_offset..]
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(dll_bytes.len() - name_offset);
        let name =
            std::str::from_utf8(&dll_bytes[name_offset..name_offset + name_end]).unwrap_or("");

        if name == target {
            return Ok(true);
        }
    }

    Ok(false)
}

/// Convert an RVA to a file offset using the section table.
fn rva_to_offset(dll_bytes: &[u8], nt_offset: usize, rva: usize) -> Result<usize, String> {
    let num_sections =
        u16::from_le_bytes(dll_bytes[nt_offset + 6..nt_offset + 8].try_into().unwrap()) as usize;
    let opt_header_size = u16::from_le_bytes(
        dll_bytes[nt_offset + 0x14..nt_offset + 0x16]
            .try_into()
            .unwrap(),
    ) as usize;
    let sections_start = nt_offset + 0x18 + opt_header_size;

    for i in 0..num_sections {
        let sec = sections_start + i * 40;
        let va = u32::from_le_bytes(dll_bytes[sec + 12..sec + 16].try_into().unwrap()) as usize;
        let raw_size =
            u32::from_le_bytes(dll_bytes[sec + 16..sec + 20].try_into().unwrap()) as usize;
        let raw_ptr =
            u32::from_le_bytes(dll_bytes[sec + 20..sec + 24].try_into().unwrap()) as usize;
        let virt_size =
            u32::from_le_bytes(dll_bytes[sec + 8..sec + 12].try_into().unwrap()) as usize;
        let sec_size = if raw_size > 0 { raw_size } else { virt_size };

        if rva >= va && rva < va + sec_size {
            return Ok(raw_ptr + (rva - va));
        }
    }

    // If RVA is in headers (before first section)
    if rva < 0x1000 {
        return Ok(rva);
    }

    Err(format!("RVA 0x{:X} not found in any section", rva))
}

/// ROR13 hash of an export name.
pub fn hash_export_name(name: &str) -> u32 {
    let mut hash: u32 = 0;
    for &b in name.as_bytes() {
        hash = hash.rotate_right(13);
        hash = hash.wrapping_add(b as u32);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_known_values() {
        assert_ne!(hash_export_name("core_main"), 0);
        assert_ne!(
            hash_export_name("LoadLibraryA"),
            hash_export_name("GetProcAddress")
        );
    }
}
