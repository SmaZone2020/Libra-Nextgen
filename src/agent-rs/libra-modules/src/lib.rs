// Many modules declare Win32 FFI structs whose field/type names mirror the
// Windows API (e.g. dwUser, WAVEHDR); non_snake_case / acronyms are intentional.
#![allow(non_snake_case)]
#![allow(clippy::upper_case_acronyms)]

pub mod anti_analysis;
pub mod recon;
