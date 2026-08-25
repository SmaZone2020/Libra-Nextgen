//! Stub module — placeholder for future standalone shellcode stub.
//!
//! Currently the reflective loading is performed by the loader binary itself
//! (which has direct access to Win32 APIs). A standalone PIC stub could be
//! added later for injection scenarios where the loader isn't the host process.

/// Get the stub size (currently 0 — loader handles mapping).
#[allow(dead_code)]
pub fn stub_size() -> usize {
    0
}
