//! SSN / syscall 指令地址的字节级提取（HellsGate 思路的独立实现）。
//!
//! 说明：`4C 8B D1 B8`（`mov r10, rcx; mov eax, imm32`）与 `0F 05`（`syscall`）
//! 是 Windows 自身生成的 ntdll syscall stub 形态，不是任何 C2 的私有特征。
//! 本实现只复用这一条 CPU/OS 层面的既定事实，搜索窗口、边界与常量命名
//! 均与参考实现不同。

/// 在 stub 头部搜索的字节数上限。
const STUB_PROBE_WINDOW: usize = 64;

/// `syscall` 指令相对 stub 头部的搜索窗口（字节）。
const SYSCALL_OPCODE_WINDOW: usize = 32;

/// `mov r10, rcx; mov eax, imm32`
const STUB_PROLOGUE: [u8; 4] = [0x4C, 0x8B, 0xD1, 0xB8];

/// `syscall`
const SYSCALL_OPCODE: [u8; 2] = [0x0F, 0x05];

/// 提取结果：syscall 服务号（SSN）与可复用的 `syscall` 指令地址。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StubProbe {
    pub ssn: u16,
    /// 指向 `0F 05`（syscall）指令的地址，其后的 `ret` 会把控制权还给调用者。
    pub trampoline: usize,
}

/// 在 `address` 指向的 syscall stub 内扫描，提取 SSN 与 trampoline。
///
/// # Safety
/// `address` 必须指向可读的 ntdll stub。
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

    // 从 prologue 之后开始找 syscall 指令。
    let tail = &bytes[pos..(pos + SYSCALL_OPCODE_WINDOW).min(bytes.len())];
    let off = find_bytes(tail, &SYSCALL_OPCODE)?;
    let trampoline = address + pos + off;

    Some(StubProbe { ssn, trampoline })
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|w| w == needle)
}

#[cfg(test)]
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
