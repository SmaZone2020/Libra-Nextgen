//! Ekko sleep 混淆集成测试（独立进程，避免与其他测试并行时的镜像加密冲突）。

#![cfg(windows)]

use libra_syscalls::{init, obfuscated_sleep};

#[test]
fn obfuscated_sleep_roundtrip() {
    init().expect("init libra-syscalls");

    // 在独立线程执行，主线程 join 阻塞在内核 —— 模拟「无其他业务线程」的
    // 混淆前提（Havoc 在存在业务线程时也会自动降级为普通 sleep）。
    let start = std::time::Instant::now();
    let ok = std::thread::spawn(|| unsafe { obfuscated_sleep(150) })
        .join()
        .expect("worker panicked");
    let elapsed = start.elapsed();

    // CI 环境（实时防护/调度敏感）：ekko 环节可能失败并回退普通 sleep——
    // 睡眠语义必须满足（>=120ms），混淆路径在本地开发机严格断言。
    if !ok {
        let is_ci = std::env::var("CI").map(|v| v == "true").unwrap_or(false);
        eprintln!(
            "obfuscated sleep fell back to plain sleep (elapsed {elapsed:?}{})",
            if is_ci { ", CI environment — tolerated" } else { "" }
        );
        if !is_ci {
            panic!("obfuscated sleep should succeed");
        }
    }
    assert!(
        elapsed.as_millis() >= 120,
        "should sleep ~150ms, got {elapsed:?}"
    );

    // 返回后模块仍可执行（RC4 加密/解密往返成功，否则这里早已崩溃）。
}
