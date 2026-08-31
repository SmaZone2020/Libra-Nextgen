//!

#![allow(dead_code)]

const MZ_MAGIC: u16 = 0x5A4D;
const PE_SIGNATURE: u32 = 0x0000_4550; // "PE\0\0"

#[inline]
unsafe fn rd_u16(p: usize) -> u16 {
    (p as *const u16).read_unaligned()
}

#[inline]
unsafe fn rd_u32(p: usize) -> u32 {
    (p as *const u32).read_unaligned()
}

#[inline]
unsafe fn rd_i32(p: usize) -> i32 {
    (p as *const i32).read_unaligned()
}

pub struct PeImage {
    pub base: usize,
}

impl PeImage {
    ///
    /// # Safety
    pub unsafe fn parse(base: usize) -> Option<PeImage> {
        if base == 0 {
            return None;
        }
        if rd_u16(base) != MZ_MAGIC {
            return None;
        }
        let e_lfanew = rd_i32(base + 0x3C);
        if e_lfanew <= 0 {
            return None;
        }
        let nt = base + e_lfanew as usize;
        if rd_u32(nt) != PE_SIGNATURE {
            return None;
        }
        Some(PeImage { base })
    }

    ///
    /// # Safety
    pub unsafe fn section_range(&self, name: &[u8; 8]) -> Option<(usize, usize)> {
        let nt = self.base + rd_i32(self.base + 0x3C) as usize;
        let file_header = nt + 4;
        let num_sections = rd_u16(file_header + 2) as usize;
        let size_opt = rd_u16(file_header + 16) as usize;
        let opt = nt + 24;
        let section_start = opt + size_opt;

        for i in 0..num_sections {
            let sec = section_start + i * 40;
            let sec_name = core::slice::from_raw_parts(sec as *const u8, 8);
            if sec_name == name.as_slice() {
                let virtual_size = rd_u32(sec + 8) as usize;
                let virtual_addr = rd_u32(sec + 12) as usize;
                let raw_size = rd_u32(sec + 16) as usize;
                let size = virtual_size.max(raw_size);
                return Some((self.base + virtual_addr, size));
            }
        }
        None
    }

    ///
    /// # Safety
    pub unsafe fn size_of_image(&self) -> usize {
        let nt = self.base + rd_i32(self.base + 0x3C) as usize;
        let opt = nt + 24;
        rd_u32(opt + 0x38) as usize
    }

    ///
    /// # Safety
    pub unsafe fn scan_executable(&self, pattern: &[u8]) -> Option<usize> {
        const IMAGE_SCN_MEM_EXECUTE: u32 = 0x2000_0000;

        let nt = self.base + rd_i32(self.base + 0x3C) as usize;
        let file_header = nt + 4;
        let num_sections = rd_u16(file_header + 2) as usize;
        let size_opt = rd_u16(file_header + 16) as usize;
        let opt = nt + 24;
        let section_start = opt + size_opt;

        for i in 0..num_sections {
            let sec = section_start + i * 40;
            let virtual_size = rd_u32(sec + 8) as usize;
            let virtual_addr = rd_u32(sec + 12) as usize;
            let raw_size = rd_u32(sec + 16) as usize;
            let characteristics = rd_u32(sec + 36);

            if characteristics & IMAGE_SCN_MEM_EXECUTE == 0 {
                continue;
            }

            let sec_va = self.base + virtual_addr;
            let len = virtual_size.max(raw_size);
            if len == 0 {
                continue;
            }

            let bytes = core::slice::from_raw_parts(sec_va as *const u8, len);
            if let Some(off) = bytes.windows(pattern.len()).position(|w| w == pattern) {
                return Some(sec_va + off);
            }
        }
        None
    }

    ///
    /// # Safety
    pub unsafe fn export_table(&self) -> Option<ExportTable> {
        let nt = self.base + rd_i32(self.base + 0x3C) as usize;
        // OptionalHeader = NT + 4(signature) + 20(FileHeader)
        let opt = nt + 24;
        let dir_rva = rd_u32(opt + 112);
        let dir_size = rd_u32(opt + 116);
        if dir_rva == 0 || dir_size == 0 {
            return None;
        }
        let exp = self.base + dir_rva as usize;
        Some(ExportTable {
            number_of_functions: rd_u32(exp + 20),
            number_of_names: rd_u32(exp + 24),
            address_of_functions: rd_u32(exp + 28),
            address_of_names: rd_u32(exp + 32),
            address_of_name_ordinals: rd_u32(exp + 36),
            dir_start: exp,
            dir_end: exp + dir_size as usize,
        })
    }
}

pub struct ExportTable {
    pub number_of_functions: u32,
    pub number_of_names: u32,
    pub address_of_functions: u32,
    pub address_of_names: u32,
    pub address_of_name_ordinals: u32,
    pub dir_start: usize,
    pub dir_end: usize,
}

impl ExportTable {
    ///
    /// # Safety
    pub unsafe fn each_export<F: FnMut(&str, usize)>(&self, base: usize, mut f: F) {
        for i in 0..self.number_of_names as usize {
            let name_rva = rd_u32(base + self.address_of_names as usize + i * 4) as usize;
            let ordinal = rd_u16(base + self.address_of_name_ordinals as usize + i * 2) as usize;
            let func_rva = rd_u32(base + self.address_of_functions as usize + ordinal * 4) as usize;

            let func_addr = base + func_rva;
            if func_rva >= self.dir_start.saturating_sub(base)
                && func_rva < self.dir_end.saturating_sub(base)
            {
                continue;
            }

            let name = read_cstr(base + name_rva);
            f(name, func_addr);
        }
    }
}

unsafe fn read_cstr(mut p: usize) -> &'static str {
    let start = p;
    while *(p as *const u8) != 0 {
        p += 1;
    }
    let len = p - start;
    let slice = core::slice::from_raw_parts(start as *const u8, len);
    core::str::from_utf8_unchecked(slice)
}
