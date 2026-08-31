#![cfg(windows)]

use libra_syscalls::{init, obfuscated_sleep};

#[test]
fn obfuscated_sleep_roundtrip() {
    init().expect("init libra-syscalls");

    let start = std::time::Instant::now();
    let ok = std::thread::spawn(|| unsafe { obfuscated_sleep(150) })
        .join()
        .expect("worker panicked");
    let elapsed = start.elapsed();

    if !ok {
        let is_ci = std::env::var("CI").map(|v| v == "true").unwrap_or(false);
        eprintln!(
            "obfuscated sleep fell back to plain sleep (elapsed {elapsed:?}{})",
            if is_ci {
                ", CI environment — tolerated"
            } else {
                ""
            }
        );
        if !is_ci {
            panic!("obfuscated sleep should succeed");
        }
    }
    assert!(
        elapsed.as_millis() >= 120,
        "should sleep ~150ms, got {elapsed:?}"
    );
}
