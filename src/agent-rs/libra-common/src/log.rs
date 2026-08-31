//! OPSEC-safe logging.
//!
//! `dlog!` compiles to a branch that is dead in release builds
//! (`cfg!(debug_assertions)` is a compile-time constant), so a shipped agent
//! never writes beacon/task details to stderr or any log file. Debug builds
//! keep full output for development.
//!
//! Note: the macro must work in expression position (match arms, `.map_err(|e|
//! dlog!(...))`), so it expands to an `if` expression rather than using an
//! attribute on a block.

/// Whether verbose agent logging is active. Debug builds always log; in release
/// builds a shipped agent stays silent unless the operator explicitly sets
/// `LIBRA_DEBUG=1` (dev/diagnostic runs) — the default footprint remains zero.
pub fn debug_enabled() -> bool {
    static DBG: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if cfg!(debug_assertions) {
        return true;
    }
    *DBG.get_or_init(|| {
        std::env::var("LIBRA_DEBUG")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    })
}

/// Log to stderr when debugging is active (`debug_enabled()`); dead branch in
/// a shipped release without the explicit opt-in.
#[macro_export]
macro_rules! dlog {
    ($($arg:tt)*) => {
        if $crate::log::debug_enabled() {
            eprintln!($($arg)*);
            let _ = ::std::io::Write::flush(&mut ::std::io::stderr());
        }
    };
}

/// Log to stderr only when the crate is built with the `verbose` feature or in
/// debug builds. Used by crates that may want verbose output in release dev
/// builds (e.g. loader diagnostics) without shipping it by default.
#[macro_export]
macro_rules! vlog {
    ($($arg:tt)*) => {
        if cfg!(any(debug_assertions, feature = "verbose")) {
            eprintln!($($arg)*);
            let _ = ::std::io::Write::flush(&mut ::std::io::stderr());
        }
    };
}
