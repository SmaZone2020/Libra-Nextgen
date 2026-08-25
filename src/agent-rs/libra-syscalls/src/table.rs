//! Syscall 表：一次枚举 ntdll 的 `Nt*` 导出，按地址排序，供 SSN 解析与
//! 邻居推导使用（HalosGate 思路的表驱动独立实现，不逐字节模仿参考代码）。

use crate::extract::probe_stub;
use crate::ffi::{wide, GetModuleHandleW};
use crate::pe::PeImage;

/// 单个 `Nt*` 导出项。
pub struct NtEntry {
    pub name: String,
    pub address: usize,
}

/// 解析完成的 ntdll syscall 索引。
pub struct SyscallTable {
    pub base: usize,
    /// 按地址升序排列的 `Nt*` 导出。
    pub entries: Vec<NtEntry>,
    /// 相邻 syscall stub 的典型地址间隔。
    pub stride: usize,
    /// 从任一未 hook 的 stub 中提取的 `syscall` 指令地址（所有调用共用）。
    pub trampoline: usize,
}

impl SyscallTable {
    /// 枚举 ntdll 导出并构建索引。
    pub fn build() -> Result<Self, &'static str> {
        let base = unsafe { GetModuleHandleW(wide("ntdll.dll").as_ptr()) as usize };
        if base == 0 {
            return Err("ntdll not loaded");
        }

        let img = unsafe { PeImage::parse(base) }.ok_or("bad ntdll image")?;
        let exp = unsafe { img.export_table() }.ok_or("ntdll has no export table")?;

        let mut entries: Vec<NtEntry> = Vec::new();
        unsafe {
            exp.each_export(base, |name, addr| {
                if name.starts_with("Nt") {
                    entries.push(NtEntry {
                        name: name.to_string(),
                        address: addr,
                    });
                }
            });
        }

        entries.sort_by_key(|e| e.address);
        if entries.is_empty() {
            return Err("no Nt* exports found");
        }

        // stride = 相邻导出地址的最小正间隔（避免被 hook 造成的非标准间隔干扰）。
        let mut stride = usize::MAX;
        for w in entries.windows(2) {
            let d = w[1].address - w[0].address;
            if d > 0 && d < stride {
                stride = d;
            }
        }
        if stride == usize::MAX {
            stride = 0;
        }

        let mut trampoline = 0usize;
        for e in &entries {
            if let Some(p) = unsafe { probe_stub(e.address) } {
                trampoline = p.trampoline;
                break;
            }
        }

        Ok(SyscallTable {
            base,
            entries,
            stride,
            trampoline,
        })
    }

    /// 解析某个 `Nt*` 的 SSN。优先直接提取，失败则走邻居推导。
    pub fn resolve_ssn(&self, name: &str) -> Result<u16, &'static str> {
        let idx = self
            .entries
            .iter()
            .position(|e| e.name == name)
            .ok_or("export not found")?;

        let target = self.entries[idx].address;
        if let Some(p) = unsafe { probe_stub(target) } {
            return Ok(p.ssn);
        }

        self.resolve_via_neighbors(idx)
            .ok_or("ssn unresolved (stub hooked?)")
    }

    /// 用最近的可解析邻居反推目标 SSN（前提：SSN 按地址连续递增）。
    fn resolve_via_neighbors(&self, idx: usize) -> Option<u16> {
        let target = self.entries[idx].address;
        let stride = self.stride;
        if stride == 0 {
            return None;
        }

        for dist in 1..self.entries.len() {
            for dir in [-1i64, 1i64] {
                let ni = idx as i64 + dir * dist as i64;
                if ni < 0 || ni >= self.entries.len() as i64 {
                    continue;
                }
                let neighbor = &self.entries[ni as usize];
                if let Some(p) = unsafe { probe_stub(neighbor.address) } {
                    let delta = (target as i64 - neighbor.address as i64) / stride as i64;
                    let ssn = p.ssn as i64 + delta;
                    if (0..=u16::MAX as i64).contains(&ssn) {
                        return Some(ssn as u16);
                    }
                }
            }
        }
        None
    }
}
