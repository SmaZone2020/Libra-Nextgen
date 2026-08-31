//!
//!
//!

#![allow(non_upper_case_globals)]

pub mod clr_host;
pub mod etw;

pub fn execute_inline(script: &str, timeout_secs: u64) -> String {
    execute_inline_opts(script, timeout_secs, false)
}

///
///
pub fn execute_inline_opts(script: &str, timeout_secs: u64, suppress_etw: bool) -> String {
    let _etw = if suppress_etw {
        etw::EtwSuppressor::suppress()
    } else {
        None
    };
    clr_host::execute_inline(script, timeout_secs)
}
