//! 共享辅助（本体仅剩 HTTP/阻塞池工具；WS 侧工具已随 realtime 模块搬出）。

/// Run a blocking (sync I/O / CPU-bound) closure on the blocking pool so it
/// does not stall the async runtime worker threads.
pub(crate) async fn blocking_string<F>(f: F) -> String
where
    F: FnOnce() -> String + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .unwrap_or_else(|_| r#"{"error":"blocking task panicked"}"#.to_string())
}

pub(crate) async fn blocking_val<F, T>(f: F) -> T
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .unwrap_or_else(|_| panic!("blocking task panicked"))
}
