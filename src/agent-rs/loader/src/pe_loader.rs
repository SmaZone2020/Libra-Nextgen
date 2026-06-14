//! Reflective PE loader — maps a DLL from raw bytes into memory,
//! fixes relocations, resolves imports, and calls the entry point.
//! Windows-only. Linux uses memfd_create + dlopen (TODO).

use std::ptr;

// ── PE Constants ──────────────────────────────────────────────────────

const IMAGE_DOS_SIGNATURE: u16 = 0x5A4D; // "MZ"
const IMAGE_NT_SIGNATURE: u32 = 0x00004550; // "PE\0\0"
const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
const IMAGE_DIRECTORY_ENTRY_IMPORT: usize = 1;
const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
const IMAGE_REL_BASED_DIR64: u32 = 10;
const IMAGE_REL_BASED_HIGHLOW: u32 = 3;
const PAGE_EXECUTE_READ: u32 = 0x20;
const PAGE_EXECUTE_READWRITE: u32 = 0x40;
const PAGE_READONLY: u32 = 0x02;
const PAGE_READWRITE: u32 = 0x04;
const MEM_COMMIT: u32 = 0x1000;
const MEM_RESERVE: u32 = 0x2000;

// ── PE Structures ─────────────────────────────────────────────────────

#[repr(C)]
struct ImageDosHeader {
    e_magic: u16,
    _e_cblp: u16,
    _e_cp: u16,
    _e_crlc: u16,
    _e_cparhdr: u16,
    _e_minalloc: u16,
    _e_maxalloc: u16,
    _e_ss: u16,
    _e_sp: u16,
    _e_csum: u16,
    _e_ip: u16,
    _e_cs: u16,
    _e_lfarlc: u16,
    _e_ovno: u16,
    _e_res: [u16; 4],
    _e_oemid: u16,
    _e_oeminfo: u16,
    _e_res2: [u16; 10],
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
    characteristics: u16,
}

#[repr(C)]
struct ImageDataDirectory {
    virtual_address: u32,
    size: u32,
}

#[repr(C)]
struct ImageOptionalHeader64 {
    magic: u16,
    _major_linker_version: u8,
    _minor_linker_version: u8,
    _size_of_code: u32,
    _size_of_initialized_data: u32,
    _size_of_uninitialized_data: u32,
    address_of_entry_point: u32,
    _base_of_code: u32,
    image_base: u64,
    section_alignment: u32,
    file_alignment: u32,
    _major_operating_system_version: u16,
    _minor_operating_system_version: u16,
    _major_image_version: u16,
    _minor_image_version: u16,
    _major_subsystem_version: u16,
    _minor_subsystem_version: u16,
    _win32_version_value: u32,
    size_of_image: u32,
    size_of_headers: u32,
    _check_sum: u32,
    _subsystem: u16,
    _dll_characteristics: u16,
    _size_of_stack_reserve: u64,
    _size_of_stack_commit: u64,
    _size_of_heap_reserve: u64,
    _size_of_heap_commit: u64,
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
    ordinal: u64,
    function: u64,
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

// ── Reflective Loader ─────────────────────────────────────────────────

/// Reflectively load a PE DLL from raw bytes into memory.
/// Returns a function pointer to the DLL's entry point:
///   `extern "system" fn(config_ptr: *const u8, config_len: usize)`
///
/// # Safety
/// The caller must ensure `dll_bytes` is a valid PE DLL.
#[cfg(target_os = "windows")]
pub unsafe fn reflective_load(dll_bytes: &[u8]) -> Result<extern "system" fn(*const u8, usize), String> {
    let base = dll_bytes.as_ptr();

    // 1. Parse DOS header
    if dll_bytes.len() < std::mem::size_of::<ImageDosHeader>() {
        return Err("DLL too small for DOS header".into());
    }
    let dos = &*(base as *const ImageDosHeader);
    if dos.e_magic != IMAGE_DOS_SIGNATURE {
        return Err("Invalid DOS signature".into());
    }

    // 2. Parse NT headers
    let nt_offset = dos.e_lfanew as usize;
    if nt_offset + std::mem::size_of::<ImageNtHeaders64>() > dll_bytes.len() {
        return Err("NT headers out of bounds".into());
    }
    let nt = &*(base.add(nt_offset) as *const ImageNtHeaders64);
    if nt.signature != IMAGE_NT_SIGNATURE {
        return Err("Invalid NT signature".into());
    }
    if nt.file_header.machine != IMAGE_FILE_MACHINE_AMD64 {
        return Err(format!("Unsupported machine type: 0x{:04X}", nt.file_header.machine));
    }

    let size_of_image = nt.optional_header.size_of_image as usize;
    let preferred_base = nt.optional_header.image_base;
    let entry_rva = nt.optional_header.address_of_entry_point;
    let num_sections = nt.file_header.number_of_sections as usize;

    // 3. Allocate memory for the image
    let alloc_base = VirtualAlloc(
        ptr::null_mut(),
        size_of_image,
        MEM_COMMIT | MEM_RESERVE,
        PAGE_READWRITE,
    );
    if alloc_base.is_null() {
        return Err("VirtualAlloc failed".into());
    }

    // 4. Copy headers
    let headers_size = nt.optional_header.size_of_headers as usize;
    let copy_size = headers_size.min(dll_bytes.len());
    ptr::copy_nonoverlapping(base, alloc_base, copy_size);

    // 5. Copy sections
    let sections_offset = nt_offset
        + std::mem::size_of::<u32>() // signature
        + std::mem::size_of::<ImageFileHeader>()
        + nt.file_header.size_of_optional_header as usize;

    for i in 0..num_sections {
        let sec_offset = sections_offset + i * std::mem::size_of::<ImageSectionHeader>();
        if sec_offset + std::mem::size_of::<ImageSectionHeader>() > dll_bytes.len() {
            return Err(format!("Section {} header out of bounds", i));
        }
        let section = &*(base.add(sec_offset) as *const ImageSectionHeader);

        if section.size_of_raw_data == 0 {
            continue;
        }

        let dst = alloc_base.add(section.virtual_address as usize);
        let src = base.add(section.pointer_to_raw_data as usize);
        let copy_len = (section.size_of_raw_data as usize).min(section.virtual_size as usize);

        if section.pointer_to_raw_data as usize + copy_len > dll_bytes.len() {
            return Err(format!("Section {} data out of bounds", i));
        }

        ptr::copy_nonoverlapping(src, dst, copy_len);
    }

    // 6. Process relocations
    let delta = (alloc_base as u64).wrapping_sub(preferred_base);

    if delta != 0 && nt.optional_header.number_of_rva_and_sizes > IMAGE_DIRECTORY_ENTRY_BASERELOC as u32 {
        let reloc_dir = &nt.optional_header.data_directory[IMAGE_DIRECTORY_ENTRY_BASERELOC];
        let reloc_rva = reloc_dir.virtual_address;
        let reloc_size = reloc_dir.size;

        if reloc_rva > 0 && reloc_size > 0 {
            let mut offset = 0u32;
            while offset < reloc_size {
                let reloc_block = alloc_base.add(reloc_rva as usize + offset as usize) as *const ImageBaseRelocation;
                let block = &*reloc_block;

                if block.virtual_address == 0 || block.size_of_block == 0 {
                    break;
                }

                let num_entries = (block.size_of_block as usize - 8) / 2;
                let entries_ptr = alloc_base.add(reloc_rva as usize + offset as usize + 8) as *const u16;

                for j in 0..num_entries {
                    let entry = *entries_ptr.add(j);
                    let entry_type = (entry >> 12) as u32;
                    let entry_offset = (entry & 0x0FFF) as u32;

                    match entry_type {
                        IMAGE_REL_BASED_DIR64 => {
                            let patch_addr = alloc_base.add(block.virtual_address as usize + entry_offset as usize) as *mut u64;
                            *patch_addr = (*patch_addr).wrapping_add(delta);
                        }
                        IMAGE_REL_BASED_HIGHLOW => {
                            let patch_addr = alloc_base.add(block.virtual_address as usize + entry_offset as usize) as *mut u32;
                            *patch_addr = (*patch_addr).wrapping_add(delta as u32);
                        }
                        0 => {} // Padding
                        _ => {
                            return Err(format!("Unsupported relocation type: {}", entry_type));
                        }
                    }
                }

                offset += block.size_of_block;
            }
        }
    }

    // 7. Resolve imports
    if nt.optional_header.number_of_rva_and_sizes > IMAGE_DIRECTORY_ENTRY_IMPORT as u32 {
        let import_dir = &nt.optional_header.data_directory[IMAGE_DIRECTORY_ENTRY_IMPORT];
        let import_rva = import_dir.virtual_address;
        let import_size = import_dir.size;

        if import_rva > 0 && import_size > 0 {
            let mut desc_offset = 0usize;
            loop {
                let desc_addr = alloc_base.add(import_rva as usize + desc_offset) as *const ImageImportDescriptor;
                let desc = &*desc_addr;

                if desc.name == 0 {
                    break;
                }

                // Read DLL name
                let dll_name_ptr = alloc_base.add(desc.name as usize) as *const u8;
                let dll_name = read_cstr(dll_name_ptr);

                let h_module = LoadLibraryA(dll_name_ptr);
                if h_module.is_null() {
                    return Err(format!("LoadLibraryA failed for: {}", dll_name));
                }

                // Walk the OriginalFirstThunk (or FirstThunk if OFT is absent)
                let oft_rva = if desc.original_first_thunk != 0 {
                    desc.original_first_thunk
                } else {
                    desc.first_thunk
                };

                let mut thunk_offset = 0usize;
                loop {
                    let thunk_addr = alloc_base.add(oft_rva as usize + thunk_offset) as *const ImageThunkData64;
                    let thunk = &*thunk_addr;

                    if thunk.address_of_data == 0 {
                        break;
                    }

                    let iat_addr = alloc_base.add(desc.first_thunk as usize + thunk_offset) as *mut u64;

                    if thunk.address_of_data & 0x8000000000000000 != 0 {
                        // Import by ordinal
                        let ordinal = (thunk.address_of_data & 0xFFFF) as u16;
                        let func_ptr = get_proc_address_ordinal(h_module, ordinal);
                        if func_ptr.is_null() {
                            return Err(format!("GetProcAddress ordinal {} failed for {}", ordinal, dll_name));
                        }
                        *iat_addr = func_ptr as u64;
                    } else {
                        // Import by name
                        let hint_name_rva = thunk.address_of_data as u32;
                        let hint_name_addr = alloc_base.add(hint_name_rva as usize);
                        // Skip 2-byte hint, then read function name
                        let func_name_ptr = hint_name_addr.add(2);
                        let func_name = read_cstr(func_name_ptr);

                        let func_ptr = GetProcAddress(h_module, func_name_ptr);
                        if func_ptr.is_null() {
                            return Err(format!("GetProcAddress failed for {}!{}", dll_name, func_name));
                        }
                        *iat_addr = func_ptr as u64;
                    }

                    thunk_offset += std::mem::size_of::<ImageThunkData64>();
                }

                desc_offset += std::mem::size_of::<ImageImportDescriptor>();
            }
        }
    }

    // 8. Set memory protections per section
    // Re-read sections from the mapped copy (headers are now at alloc_base)
    let mapped_nt = &*(alloc_base.add(nt_offset) as *const ImageNtHeaders64);
    let mapped_sections_offset = nt_offset
        + std::mem::size_of::<u32>()
        + std::mem::size_of::<ImageFileHeader>()
        + mapped_nt.file_header.size_of_optional_header as usize;

    for i in 0..num_sections {
        let sec = &*(alloc_base.add(mapped_sections_offset + i * std::mem::size_of::<ImageSectionHeader>()) as *const ImageSectionHeader);

        if sec.virtual_size == 0 {
            continue;
        }

        let sec_base = alloc_base.add(sec.virtual_address as usize);
        let sec_size = round_to_page(sec.virtual_size as usize, 4096);

        let protect = if sec.characteristics & 0x20000000 != 0 {
            // Contains code
            if sec.characteristics & 0x80000000 != 0 {
                PAGE_EXECUTE_READWRITE
            } else {
                PAGE_EXECUTE_READ
            }
        } else if sec.characteristics & 0x80000000 != 0 {
            PAGE_READWRITE
        } else {
            PAGE_READONLY
        };

        let mut old_protect = 0u32;
        VirtualProtect(sec_base, sec_size, protect, &mut old_protect);
    }

    // 9. Flush instruction cache
    FlushInstructionCache(ptr::null_mut(), alloc_base, size_of_image);

    // 10. Get entry point
    let entry_addr = alloc_base.add(entry_rva as usize);
    let entry_fn: extern "system" fn(*const u8, usize) = std::mem::transmute(entry_addr);

    Ok(entry_fn)
}

/// Read a null-terminated C string from memory.
unsafe fn read_cstr(ptr: *const u8) -> String {
    let mut len = 0;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    let slice = std::slice::from_raw_parts(ptr, len);
    String::from_utf8_lossy(slice).to_string()
}

/// GetProcAddress by ordinal (helper).
#[cfg(target_os = "windows")]
unsafe fn get_proc_address_ordinal(h_module: *mut u8, ordinal: u16) -> *mut u8 {
    GetProcAddress(h_module, ordinal as usize as *const u8)
}

/// Round size up to page boundary.
fn round_to_page(size: usize, page_size: usize) -> usize {
    (size + page_size - 1) & !(page_size - 1)
}

// ── Linux fallback (memfd_create + dlopen) ─────────────────────────────

#[cfg(target_os = "linux")]
pub unsafe fn reflective_load(dll_bytes: &[u8]) -> Result<extern "system" fn(*const u8, usize), String> {
    // Use memfd_create to create an anonymous file in memory
    let fd = libc::memfd_create(b"core\0".as_ptr() as *const libc::c_char, libc::MFD_CLOEXEC);
    if fd < 0 {
        return Err("memfd_create failed".into());
    }

    // Write DLL bytes to the memfd
    let mut written = 0usize;
    while written < dll_bytes.len() {
        let n = libc::write(
            fd,
            dll_bytes[written..].as_ptr() as *const libc::c_void,
            dll_bytes.len() - written,
        );
        if n < 0 {
            libc::close(fd);
            return Err("write to memfd failed".into());
        }
        written += n as usize;
    }

    // Build path: /proc/self/fd/{fd}
    let path = format!("/proc/self/fd/{}\0", fd);

    // dlopen the memfd
    let handle = libc::dlopen(path.as_ptr() as *const libc::c_char, libc::RTLD_NOW);
    libc::close(fd);

    if handle.is_null() {
        let err = libc::dlerror();
        let msg = if err.is_null() {
            "dlopen failed (unknown error)".to_string()
        } else {
            String::from_utf8_lossy(std::ffi::CStr::from_ptr(err).to_bytes()).to_string()
        };
        return Err(format!("dlopen failed: {}", msg));
    }

    // Find the entry point symbol
    let sym = libc::dlsym(handle, b"core_main\0".as_ptr() as *const libc::c_char);
    if sym.is_null() {
        return Err("core_main symbol not found".into());
    }

    let entry_fn: extern "system" fn(*const u8, usize) = std::mem::transmute(sym);
    Ok(entry_fn)
}
