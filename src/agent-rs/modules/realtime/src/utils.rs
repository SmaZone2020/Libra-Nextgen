//! 共享辅助（从 libra-engine 搬迁的 WS 侧工具）。

use serde_json::Value;

use libra_common::protocol::WebSocketMessage;
use crate::ws::{WsSender, ws_send_via};

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
    libra_common::dlog!("[realtime:SEND] {} | rid={} | data={}",
        msg_type,
        rid.unwrap_or("-"),
        data_str
    );
    ws_send_via(tx, agent_id, msg_type, data_str, rid).await;
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
