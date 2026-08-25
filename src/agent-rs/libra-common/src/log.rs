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

/// Log to stderr only in debug builds. Compiles to a dead branch in release.
#[macro_export]
macro_rules! dlog {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
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
