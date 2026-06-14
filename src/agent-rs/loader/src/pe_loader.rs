//! In-memory PE loader — maps a DLL entirely in memory without touching disk.
//!
//! Uses manual PE mapping: VirtualAlloc + section copy + relocations + imports.
//! Skips DllMain (Rust cdylib TLS init crashes when manually mapped).
//! Resolves the target export directly from the export table.

use std::ptr;

// ── PE Constants ──────────────────────────────────────────────────────

const IMAGE_DOS_SIGNATURE: u16 = 0x5A4D;
const IMAGE_NT_SIGNATURE: u32 = 0x00004550;
const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
const IMAGE_DIRECTORY_ENTRY_EXPORT: usize = 0;
const IMAGE_DIRECTORY_ENTRY_IMPORT: usize = 1;
const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
const IMAGE_REL_BASED_DIR64: u32 = 10;
const IMAGE_REL_BASED_HIGHLOW: u32 = 3;
const PAGE_EXECUTE_READ: u32 = 0x20;
const PAGE_READONLY: u32 = 0x02;
const PAGE_READWRITE: u32 = 0x04;
const MEM_COMMIT: u32 = 0x1000;
const MEM_RESERVE: u32 = 0x2000;

// ── PE Structures ─────────────────────────────────────────────────────

#[repr(C)]
struct ImageDosHeader {
    e_magic: u16,
    _pad: [u8; 58],
    e_lfanew: i32,
}

#[repr(C)]
struct ImageFileHeader {
    machine: u16,
    number_of_sections: u16,
    _time_date_stamp: u32,
    _pointer_to_symbol_table: u32,
    _number_of_symbols: u32,
    size_of_optional_header: u16,
    _characteristics: u16,
}

#[repr(C)]
struct ImageDataDirectory {
    virtual_address: u32,
    size: u32,
}

#[repr(C)]
struct ImageOptionalHeader64 {
    _magic: u16,
    _major_linker_version: u8,
    _minor_linker_version: u8,
    _size_of_code: u32,
    _size_of_initialized_data: u32,
    _size_of_uninitialized_data: u32,
    address_of_entry_point: u32,
    _base_of_code: u32,
    image_base: u64,
    _section_alignment: u32,
    _file_alignment: u32,
    _major_os_ver: u16,
    _minor_os_ver: u16,
    _major_img_ver: u16,
    _minor_img_ver: u16,
    _major_sub_ver: u16,
    _minor_sub_ver: u16,
    _win32_ver: u32,
    size_of_image: u32,
    size_of_headers: u32,
    _checksum: u32,
    _subsystem: u16,
    _dll_chars: u16,
    _stack_reserve: u64,
    _stack_commit: u64,
    _heap_reserve: u64,
    _heap_commit: u64,
    _loader_flags: u32,
    number_of_rva_and_sizes: u32,
    data_directory: [ImageDataDirectory; 16],
}

#[repr(C)]
struct ImageNtHeaders64 {
    signature: u32,
    file_header: ImageFileHeader,
    optional_header: ImageOptionalHeader64,
}

#[repr(C)]
struct ImageSectionHeader {
    _name: [u8; 8],
    virtual_size: u32,
    virtual_address: u32,
    size_of_raw_data: u32,
    pointer_to_raw_data: u32,
    _pointer_to_relocations: u32,
    _pointer_to_linenumbers: u32,
    _number_of_relocations: u16,
    _number_of_linenumbers: u16,
    characteristics: u32,
}

#[repr(C)]
struct ImageImportDescriptor {
    original_first_thunk: u32,
    _time_date_stamp: u32,
    _forwarder_chain: u32,
    name: u32,
    first_thunk: u32,
}

#[repr(C)]
struct ImageBaseRelocation {
    virtual_address: u32,
    size_of_block: u32,
}

#[repr(C)]
struct ImageExportDirectory {
    _characteristics: u32,
    _time_date_stamp: u32,
    _major_version: u16,
    _minor_version: u16,
    _name: u32,
    _base: u32,
    number_of_functions: u32,
    number_of_names: u32,
    address_of_functions: u32,
    address_of_names: u32,
    address_of_name_ordinals: u32,
}

// ── Win32 API ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
extern "system" {
    fn VirtualAlloc(addr: *mut u8, size: usize, alloc_type: u32, protect: u32) -> *mut u8;
    fn VirtualProtect(addr: *mut u8, size: usize, new_protect: u32, old_protect: *mut u32) -> i32;
    fn FlushInstructionCache(process: *mut u8, addr: *const u8, size: usize) -> i32;
    fn LoadLibraryA(name: *const u8) -> *mut u8;
    fn GetProcAddress(module: *mut u8, name: *const u8) -> *mut u8;
}

// ── Public API ────────────────────────────────────────────────────────

/// Load a PE DLL from raw bytes entirely in memory and return a pointer to the named export.
///
/// This performs manual PE mapping without writing anything to disk:
/// 1. Allocates virtual memory for the image
/// 2. Copies PE headers and sections
/// 3. Processes base relocations
/// 4. Resolves import table
/// 5. Sets section memory protections
/// 6. Resolves the target export
///
/// DllMain is intentionally NOT called — Rust cdylib TLS initialization
/// crashes when the DLL is manually mapped. The export function (core_main)
/// handles its own initialization.
#[cfg(target_os = "windows")]
pub unsafe fn reflective_load(dll_bytes: &[u8]) -> Result<extern "system" fn(*const u8, usize), String> {
    let base = dll_bytes.as_ptr();
    let len = dll_bytes.len();

    // ── Parse and validate PE headers ──
    if len < std::mem::size_of::<ImageDosHeader>() {
        return Err("Too small for DOS header".into());
    }
    let dos = &*(base as *const ImageDosHeader);
    if dos.e_magic != IMAGE_DOS_SIGNATURE {
        return Err("Invalid DOS signature".into());
    }

    let nt_offset = dos.e_lfanew as usize;
    if nt_offset + std::mem::size_of::<ImageNtHeaders64>() > len {
        return Err("NT headers out of bounds".into());
    }
    let nt = &*(base.add(nt_offset) as *const ImageNtHeaders64);
    if nt.signature != IMAGE_NT_SIGNATURE {
        return Err("Invalid NT signature".into());
    }
    if nt.file_header.machine != IMAGE_FILE_MACHINE_AMD64 {
        return Err(format!("Unsupported machine: 0x{:04X}", nt.file_header.machine));
    }

    let opt = &nt.optional_header;
    let size_of_image = opt.size_of_image as usize;
    let preferred_base = opt.image_base;
    let num_sections = nt.file_header.number_of_sections as usize;

    // ── Collect section headers ──
    let sections_offset = nt_offset
        + 4  // signature
        + std::mem::size_of::<ImageFileHeader>()
        + nt.file_header.size_of_optional_header as usize;

    let mut sections: Vec<&ImageSectionHeader> = Vec::with_capacity(num_sections);
    for i in 0..num_sections {
        let sec_off = sections_offset + i * std::mem::size_of::<ImageSectionHeader>();
        if sec_off + std::mem::size_of::<ImageSectionHeader>() > len {
            return Err(format!("Section {} out of bounds", i));
        }
        sections.push(&*(base.add(sec_off) as *const ImageSectionHeader));
    }

    // ── Allocate image memory ──
    let alloc_base = VirtualAlloc(
        preferred_base as *mut u8, size_of_image, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE,
    );
    let alloc_base = if alloc_base.is_null() {
        let ab = VirtualAlloc(ptr::null_mut(), size_of_image, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if ab.is_null() {
            return Err("VirtualAlloc failed".into());
        }
        ab
    } else {
        alloc_base
    };

    let delta = (alloc_base as u64).wrapping_sub(preferred_base);

    // ── Copy headers ──
    let headers_size = opt.size_of_headers as usize;
    ptr::copy_nonoverlapping(base, alloc_base, headers_size.min(len));

    // ── Copy sections ──
    for sec in &sections {
        if sec.size_of_raw_data == 0 {
            continue;
        }
        let raw_offset = sec.pointer_to_raw_data as usize;
        let copy_len = (sec.size_of_raw_data as usize).min(sec.virtual_size as usize);
        if raw_offset + copy_len > len {
            continue;
        }
        let dst = alloc_base.add(sec.virtual_address as usize);
        let src = base.add(raw_offset);
        ptr::copy_nonoverlapping(src, dst, copy_len);
    }

    // ── Process base relocations ──
    if delta != 0 {
        process_relocations(alloc_base, opt, delta)?;
    }

    // ── Resolve imports ──
    resolve_imports(alloc_base, opt)?;

    // ── Set section memory protections ──
    for sec in &sections {
        if sec.virtual_size == 0 {
            continue;
        }
        let sec_base = alloc_base.add(sec.virtual_address as usize);
        let sec_size = round_up(sec.virtual_size as usize, 4096);
        let protect = section_protection(sec.characteristics);
        let mut old = 0u32;
        VirtualProtect(sec_base, sec_size, protect, &mut old);
    }

    // ── Flush instruction cache ──
    FlushInstructionCache(ptr::null_mut(), alloc_base, size_of_image);

    // ── NOTE: DllMain is NOT called ──
    // Rust cdylib DllMain initializes TLS and panics when manually mapped.
    // core_main handles its own initialization.

    // ── Find export ──
    let entry = find_export(alloc_base, opt, b"core_main")?;
    let entry_fn: extern "system" fn(*const u8, usize) = std::mem::transmute(entry);
    Ok(entry_fn)
}

// ── Linux: memfd_create + dlopen (unchanged, this works fine) ──────────

#[cfg(target_os = "linux")]
pub unsafe fn reflective_load(dll_bytes: &[u8]) -> Result<extern "system" fn(*const u8, usize), String> {
    use std::ffi::CStr;

    let fd = libc::memfd_create(b"core\0".as_ptr() as *const libc::c_char, libc::MFD_CLOEXEC);
    if fd < 0 {
        return Err("memfd_create failed".into());
    }

    let mut written = 0usize;
    while written < dll_bytes.len() {
        let n = libc::write(fd, dll_bytes[written..].as_ptr() as *const libc::c_void, dll_bytes.len() - written);
        if n < 0 {
            libc::close(fd);
            return Err("write to memfd failed".into());
        }
        written += n as usize;
    }

    let path = format!("/proc/self/fd/{}\0", fd);
    let handle = libc::dlopen(path.as_ptr() as *const libc::c_char, libc::RTLD_NOW);
    libc::close(fd);

    if handle.is_null() {
        let err = libc::dlerror();
        let msg = if err.is_null() { "unknown".into() } else { CStr::from_ptr(err).to_string_lossy().to_string() };
        return Err(format!("dlopen failed: {}", msg));
    }

    let sym = libc::dlsym(handle, b"core_main\0".as_ptr() as *const libc::c_char);
    if sym.is_null() {
        return Err("core_main not found".into());
    }

    Ok(std::mem::transmute(sym))
}

// ── Relocations ───────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
unsafe fn process_relocations(
    alloc_base: *mut u8,
    opt: &ImageOptionalHeader64,
    delta: u64,
) -> Result<(), String> {
    if opt.number_of_rva_and_sizes as usize <= IMAGE_DIRECTORY_ENTRY_BASERELOC {
        return Ok(());
    }

    let reloc_dir = &opt.data_directory[IMAGE_DIRECTORY_ENTRY_BASERELOC];
    if reloc_dir.virtual_address == 0 || reloc_dir.size == 0 {
        return Ok(());
    }

    let mut offset = 0u32;
    let reloc_rva = reloc_dir.virtual_address;
    let reloc_size = reloc_dir.size;

    while offset < reloc_size {
        let block = &*(alloc_base.add(reloc_rva as usize + offset as usize) as *const ImageBaseRelocation);
        if block.virtual_address == 0 || block.size_of_block == 0 {
            break;
        }

        let num_entries = (block.size_of_block as usize - 8) / 2;
        let entries = alloc_base.add(reloc_rva as usize + offset as usize + 8) as *const u16;

        for j in 0..num_entries {
            let entry = *entries.add(j);
            let rtype = (entry >> 12) as u32;
            let roffset = (entry & 0x0FFF) as u32;
            let patch_addr = alloc_base.add(block.virtual_address as usize + roffset as usize);

            match rtype {
                IMAGE_REL_BASED_DIR64 => {
                    let p = patch_addr as *mut u64;
                    *p = (*p).wrapping_add(delta);
                }
                IMAGE_REL_BASED_HIGHLOW => {
                    let p = patch_addr as *mut u32;
                    *p = (*p).wrapping_add(delta as u32);
                }
                0 => {} // padding
                _ => {} // ignore unsupported types rather than failing
            }
        }

        offset += block.size_of_block;
    }
    Ok(())
}

// ── Import Resolution ─────────────────────────────────────────────────

#[cfg(target_os = "windows")]
unsafe fn resolve_imports(
    alloc_base: *mut u8,
    opt: &ImageOptionalHeader64,
) -> Result<(), String> {
    if opt.number_of_rva_and_sizes as usize <= IMAGE_DIRECTORY_ENTRY_IMPORT {
        return Ok(());
    }

    let import_dir = &opt.data_directory[IMAGE_DIRECTORY_ENTRY_IMPORT];
    if import_dir.virtual_address == 0 || import_dir.size == 0 {
        return Ok(());
    }

    let mut desc_offset = 0usize;
    loop {
        let desc = &*(alloc_base.add(import_dir.virtual_address as usize + desc_offset) as *const ImageImportDescriptor);
        if desc.name == 0 {
            break;
        }

        let dll_name_ptr = alloc_base.add(desc.name as usize);
        let h_module = LoadLibraryA(dll_name_ptr);
        if h_module.is_null() {
            let name = read_cstr(dll_name_ptr);
            return Err(format!("LoadLibraryA('{}') failed", name));
        }

        let oft_rva = if desc.original_first_thunk != 0 {
            desc.original_first_thunk
        } else {
            desc.first_thunk
        };
        let mut thunk_offset = 0usize;

        loop {
            let thunk_val = *(alloc_base.add(oft_rva as usize + thunk_offset) as *const u64);
            if thunk_val == 0 {
                break;
            }

            let iat_entry = alloc_base.add(desc.first_thunk as usize + thunk_offset) as *mut u64;

            let func = if thunk_val & 0x8000000000000000 != 0 {
                // Import by ordinal
                let ordinal = (thunk_val & 0xFFFF) as u16;
                GetProcAddress(h_module, ordinal as usize as *const u8)
            } else {
                // Import by name (skip 2-byte hint)
                let name_ptr = alloc_base.add((thunk_val as u32 as usize) + 2);
                GetProcAddress(h_module, name_ptr)
            };

            if func.is_null() {
                // Non-fatal: some imports may be optional (delay-load etc.)
                // For robustness, continue rather than fail
            }
            *iat_entry = func as u64;

            thunk_offset += 8; // sizeof(IMAGE_THUNK_DATA64)
        }

        desc_offset += std::mem::size_of::<ImageImportDescriptor>();
    }
    Ok(())
}

// ── Export Resolution ─────────────────────────────────────────────────

#[cfg(target_os = "windows")]
unsafe fn find_export(
    alloc_base: *mut u8,
    opt: &ImageOptionalHeader64,
    name: &[u8],
) -> Result<*mut u8, String> {
    if opt.number_of_rva_and_sizes as usize <= IMAGE_DIRECTORY_ENTRY_EXPORT {
        return Err("No export directory".into());
    }

    let export_dir = &opt.data_directory[IMAGE_DIRECTORY_ENTRY_EXPORT];
    if export_dir.virtual_address == 0 || export_dir.size == 0 {
        return Err("Empty export directory".into());
    }

    let exports = &*(alloc_base.add(export_dir.virtual_address as usize) as *const ImageExportDirectory);
    let names_ptr = alloc_base.add(exports.address_of_names as usize) as *const u32;
    let ordinals_ptr = alloc_base.add(exports.address_of_name_ordinals as usize) as *const u16;
    let functions_ptr = alloc_base.add(exports.address_of_functions as usize) as *const u32;

    for i in 0..exports.number_of_names as usize {
        let name_rva = *names_ptr.add(i);
        let export_name = alloc_base.add(name_rva as usize);

        let mut matches = true;
        for (j, &b) in name.iter().enumerate() {
            if *export_name.add(j) != b {
                matches = false;
                break;
            }
        }
        if matches && *export_name.add(name.len()) == 0 {
            let ordinal = *ordinals_ptr.add(i) as usize;
            let func_rva = *functions_ptr.add(ordinal);
            return Ok(alloc_base.add(func_rva as usize));
        }
    }

    Err(format!("Export '{}' not found", String::from_utf8_lossy(name)))
}

// ── Utilities ─────────────────────────────────────────────────────────

fn section_protection(characteristics: u32) -> u32 {
    let exec = characteristics & 0x20000000 != 0;
    let read = characteristics & 0x40000000 != 0;
    let write = characteristics & 0x80000000 != 0;

    match (exec, read, write) {
        (true, _, true) => 0x40,  // PAGE_EXECUTE_READWRITE
        (true, _, _) => PAGE_EXECUTE_READ,
        (false, _, true) => PAGE_READWRITE,
        (false, true, false) => PAGE_READONLY,
        _ => PAGE_READONLY,
    }
}

fn round_up(size: usize, align: usize) -> usize {
    (size + align - 1) & !(align - 1)
}

#[cfg(target_os = "windows")]
unsafe fn read_cstr(ptr: *const u8) -> String {
    let mut len = 0;
    while *ptr.add(len) != 0 && len < 256 {
        len += 1;
    }
    String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len)).to_string()
}
