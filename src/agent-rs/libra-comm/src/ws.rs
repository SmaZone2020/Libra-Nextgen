//! WebSocket communicator — real-time shell, file ops, screen/camera/mic streaming.
//! Port of WsCommunicator.cs.

use futures_util::{SinkExt, StreamExt};
use libra_common::protocol::WebSocketMessage;
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use tokio_tungstenite::tungstenite::Message;

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// WebSocket communicator for real-time agent operations.
pub struct WsCommunicator {
    ws: Option<WsStream>,
    url: String,
    agent_id: String,
}

impl WsCommunicator {
    pub fn new(base_url: &str, agent_id: &str) -> Self {
        // Build WebSocket URL from HTTP URL
        let url = base_url
            .replace("http://", "ws://")
            .replace("https://", "wss://");

        // Force IPv4 for localhost
        let ws_url = if let Some(rest) = url.strip_prefix("ws://localhost") {
            format!("ws://127.0.0.1{}", rest)
        } else if let Some(rest) = url.strip_prefix("wss://localhost") {
            format!("wss://127.0.0.1{}", rest)
        } else {
            url.clone()
        };

        // Extract authority and build WS URL with agentId query param
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
            ws: None,
            url: ws_uri,
            agent_id: agent_id.to_string(),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.ws.is_some()
    }

    pub fn agent_id(&self) -> &str {
        &self.agent_id
    }

    /// Connect to the WebSocket endpoint.
    pub async fn connect(&mut self) -> Result<(), String> {
        let (ws, _) = connect_async(&self.url).await.map_err(|e| e.to_string())?;
        self.ws = Some(ws);
        Ok(())
    }

    /// Receive the next WebSocket message. Returns None on connection close or error.
    pub async fn receive(&mut self) -> Option<WebSocketMessage> {
        let ws = self.ws.as_mut()?;

        loop {
            let msg = match ws.next().await? {
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
                    // Continue the loop for ping/pong/frame messages
                    continue;
                }
            }
        }
    }

    /// Send a WebSocket message.
    pub async fn send(&mut self, msg: &WebSocketMessage) -> Result<(), String> {
        let ws = self.ws.as_mut().ok_or("WebSocket not connected")?;
        let json = msg.to_json();
        ws.send(Message::Text(json)).await.map_err(|e| e.to_string())
    }

    /// Send a result message using a raw JSON data string.
    /// Matches WsCommunicator.SendResultRawAsync in C#.
    pub async fn send_result_raw(
        &mut self,
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

        self.send(&msg).await
    }

    /// Close the WebSocket connection gracefully.
    pub async fn close(&mut self) {
        if let Some(mut ws) = self.ws.take() {
            let _ = ws.close(None).await;
        }
    }
}

impl Drop for WsCommunicator {
    fn drop(&mut self) {
        self.ws = None;
    }
}
