use serde_json::Value;

use libra_common::protocol::WebSocketMessage;
use libra_comm::ws::{WsSender, ws_send_via};

// ── Helpers ──────────────────────────────────────────────────────────────

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

pub(crate) fn data_str<'a>(data: &'a Option<Value>, key: &str, default: &'a str) -> String {
    data.as_ref()
        .and_then(|d| d[key].as_str())
        .unwrap_or(default)
        .to_string()
}

pub(crate) fn data_u64(data: &Option<Value>, key: &str, default: u64) -> u64 {
    data.as_ref()
        .and_then(|d| d[key].as_u64())
        .unwrap_or(default)
}

pub(crate) async fn ws_send(tx: &WsSender, agent_id: &str, msg_type: &str, data_str: &str, rid: Option<&str>) {
    eprintln!("[SEND] {} | rid={} | data={}",
        msg_type,
        rid.unwrap_or("-"),
        data_str
    );
    ws_send_via(tx, agent_id, msg_type, data_str, rid).await;
}

/// Run a cloud module with a JSON input, returning its JSON output.
/// Download/load/execution failures are converted to a JSON error object so
/// the caller can always forward a well-formed response.
pub(crate) async fn run_module(
    mm: &std::sync::Arc<tokio::sync::Mutex<crate::module_manager::ModuleManager>>,
    name: &str,
    input: serde_json::Value,
) -> String {
    let mut mgr = mm.lock().await;
    match mgr.run(name, &input.to_string()).await {
        Ok(r) => r,
        Err(e) => serde_json::json!({ "error": e }).to_string(),
    }
}

pub(crate) fn send_via_channel(
    tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
    agent_id: &str,
    msg_type: &str,
    data_str: &str,
    rid: Option<&str>,
) -> Result<(), ()> {
    let data: Value = serde_json::from_str(data_str).unwrap_or(Value::String(data_str.to_string()));
    let msg = WebSocketMessage {
        msg_type: msg_type.to_string(),
        channel: agent_id.to_string(),
        data: Some(data),
        timestamp: now_millis(),
        request_id: rid.map(|s| s.to_string()),
    };
    tx.send(msg).map_err(|_| ())
}

pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
