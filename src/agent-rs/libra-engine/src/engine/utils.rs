//! 共享辅助（本体仅剩 HTTP/阻塞池工具；WS 侧工具已随 realtime 模块搬出）。

pub(crate) async fn blocking_val<F, T>(f: F) -> T
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .unwrap_or_else(|_| panic!("blocking task panicked"))
}
