//! WebSocket communicator — real-time shell, file ops, screen/camera/mic streaming.
//! Port of WsCommunicator.cs.
//!
//! The WebSocket is split into independent send and receive halves so that
//! spawned tasks (screen capture loop, etc.) can send frames without being
//! blocked by the main receive loop holding the read lock.

use futures_util::{SinkExt, StreamExt};
use futures_util::stream::{SplitSink, SplitStream};
use libra_common::protocol::WebSocketMessage;
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use tokio_tungstenite::tungstenite::Message;

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = SplitSink<WsStream, Message>;

/// Cloneable send-half handle so spawned tasks can send without contending
/// with the receive lock on WsCommunicator.
pub type WsSender = std::sync::Arc<tokio::sync::Mutex<Option<WsWrite>>>;

/// WebSocket communicator for real-time agent operations.
pub struct WsCommunicator {
    write_half: WsSender,                // shared among spawned tasks
    read_half: Option<SplitStream<WsStream>>, // owned by the receive loop
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

        let ws_uri = if let Some(rest) = ws_url.strip_prefix("ws://") {
            let parts: Vec<&str> = rest.splitn(2, '/').collect();
            format!("ws://{}/ws/agent?agentId={}", parts[0], agent_id)
        } else if let Some(rest) = ws_url.strip_prefix("wss://") {
            let parts: Vec<&str> = rest.splitn(2, '/').collect();
            format!("wss://{}/ws/agent?agentId={}", parts[0], agent_id)
        } else {
            format!("ws://127.0.0.1:5270/ws/agent?agentId={}", agent_id)
        };

        Self {
            write_half: std::sync::Arc::new(tokio::sync::Mutex::new(None)),
            read_half: None,
            url: ws_uri,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.read_half.is_some()
    }

    /// Returns a cloneable sender handle for spawned tasks.
    pub fn sender(&self) -> WsSender {
        self.write_half.clone()
    }

    /// Connect to the WebSocket endpoint.
    pub async fn connect(&mut self) -> Result<(), String> {
        let (ws, _) = connect_async(&self.url).await.map_err(|e| e.to_string())?;
        let (write, read) = ws.split();
        *self.write_half.lock().await = Some(write);
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
                    return WebSocketMessage::from_json(&text);
                }
                Message::Binary(data) => {
                    if let Ok(text) = String::from_utf8(data) {
                        return WebSocketMessage::from_json(&text);
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
        let mut write = self.write_half.lock().await;
        let w = write.as_mut().ok_or("WebSocket not connected")?;
        let json = msg.to_json();
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

    /// Close the WebSocket connection gracefully.
    pub async fn close(&mut self) {
        // Drop both halves — the Arc<Mutex<>> ensures all senders see it.
        self.read_half.take();
        *self.write_half.lock().await = None;
    }
}

/// Send a pre-built WebSocketMessage using only the sender handle.
pub async fn send_msg_via(sender: &WsSender, msg: &WebSocketMessage) {
    let json = msg.to_json();
    let mut write = sender.lock().await;
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

    let json = msg.to_json();
    let mut write = sender.lock().await;
    if let Some(w) = write.as_mut() {
        let _ = w.send(Message::Text(json)).await;
    }
}
