//!

const STUB_PROBE_WINDOW: usize = 64;

const SYSCALL_OPCODE_WINDOW: usize = 32;

/// `mov r10, rcx; mov eax, imm32`
const STUB_PROLOGUE: [u8; 4] = [0x4C, 0x8B, 0xD1, 0xB8];

/// `syscall`
const SYSCALL_OPCODE: [u8; 2] = [0x0F, 0x05];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StubProbe {
    pub ssn: u16,
    pub trampoline: usize,
}

///
/// # Safety
pub unsafe fn probe_stub(address: usize) -> Option<StubProbe> {
    if address == 0 {
        return None;
    }

    let bytes = core::slice::from_raw_parts(address as *const u8, STUB_PROBE_WINDOW);

    let pos = find_bytes(bytes, &STUB_PROLOGUE)?;
    if pos + 6 > bytes.len() {
        return None;
    }

    let ssn = u16::from_le_bytes([bytes[pos + 4], bytes[pos + 5]]);

    let tail = &bytes[pos..(pos + SYSCALL_OPCODE_WINDOW).min(bytes.len())];
    let off = find_bytes(tail, &SYSCALL_OPCODE)?;
    let trampoline = address + pos + off;

    Some(StubProbe { ssn, trampoline })
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn find_bytes_hits_and_misses() {
        let buf = [1, 2, 3, 0x4C, 0x8B, 0xD1, 0xB8, 0x0F, 0x05, 0xC3];
        assert_eq!(find_bytes(&buf, &STUB_PROLOGUE), Some(3));
        assert_eq!(find_bytes(&buf, &SYSCALL_OPCODE), Some(7));
        assert_eq!(find_bytes(&buf, &[0xDE, 0xAD]), None);
    }

    #[test]
    fn probe_rejects_null() {
        unsafe {
            assert_eq!(probe_stub(0), None);
        }
    }
}
