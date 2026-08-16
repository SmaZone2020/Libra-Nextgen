use serde_json::Value;

use libra_comm::ws::WsSender;

use super::AgentEngine;
use super::utils::{data_str, data_u64, ws_send};

// ── Screen stream ────────────────────────────────────────────────────

pub(crate) async fn start_screen_stream(
    engine: &AgentEngine,
    data: Option<Value>,
    agent_id: String,
    tx: WsSender,
) {
    if let Some(old_tx) = engine.screen_session.lock().unwrap().take() {
        let _ = old_tx.send(true);
    }

    let fps = data_u64(&data, "fps", 5).max(1).min(30) as u32;
    let quality = data_str(&data, "quality", "original").to_string();
    let screen_index = data_u64(&data, "screenIndex", 0) as u32;
    let interval_ms = 1000u64 / fps as u64;
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    engine.screen_session.lock().unwrap().replace(cancel_tx);

    tokio::spawn(async move {
        let mut stream = libra_modules::execution::ScreenStream::new();
        loop {
            if *cancel_rx.borrow() { break; }
            match stream.capture(&quality, screen_index) {
                libra_modules::execution::ScreenFrame::Keyframe { width, height, jpeg } => {
                    let data = format!(
                        r#"{{"width":{},"height":{},"jpeg":"{}"}}"#, width, height, jpeg
                    );
                    ws_send(&tx, &agent_id, "screen.frame", &data, None).await;
                }
                libra_modules::execution::ScreenFrame::Diff { blocks_json } => {
                    let data = format!(r#"{{"blocks":{}}}"#, blocks_json);
                    ws_send(&tx, &agent_id, "screen.diff", &data, None).await;
                }
                libra_modules::execution::ScreenFrame::Empty => {}
            }
            tokio::select! {
                _ = cancel_rx.changed() => break,
                _ = tokio::time::sleep(std::time::Duration::from_millis(interval_ms)) => {}
            }
        }
    });
}

// ── Camera stream ────────────────────────────────────────────────────

pub(crate) async fn start_camera_stream(
    engine: &AgentEngine,
    data: Option<Value>,
    agent_id: String,
    tx: WsSender,
    rid: Option<&str>,
) {
    // Stop any existing stream
    if let Some(cancel) = engine.camera_session.lock().unwrap().take() {
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    let idx = data_u64(&data, "cameraIndex", 0) as u32;
    let fps = data_u64(&data, "fps", 5).max(1).min(30) as u32;
    let interval = std::time::Duration::from_millis(1000u64 / fps as u64);
    let agent_id2 = agent_id.clone();
    let tx2 = tx.clone();
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let cancel2 = cancel.clone();
    engine.camera_session.lock().unwrap().replace(cancel);

    let (frame_tx, mut frame_rx) = tokio::sync::mpsc::channel::<String>(4);

    // Dedicated blocking thread — CameraStream stays on the same thread for COM
    tokio::task::spawn_blocking(move || {
        let mut stream = match libra_modules::execution::CameraStream::new(idx) {
            Ok(s) => s,
            Err(e) => {
                let _ = frame_tx.blocking_send(format!(r#"{{"error":"{}"}}"#, e));
                return;
            }
        };
        loop {
            if cancel2.load(std::sync::atomic::Ordering::Relaxed) { break; }
            let frame = match stream.capture_frame() {
                Ok(cf) => match cf {
                    libra_modules::execution::CameraFrame::Keyframe { width, height, jpeg } => {
                        format!(r#"{{"type":"keyframe","width":{},"height":{},"data":"{}"}}"#, width, height, jpeg)
                    }
                    libra_modules::execution::CameraFrame::Diff { blocks_json } => {
                        format!(r#"{{"type":"diff","blocks":{}}}"#, blocks_json)
                    }
                    libra_modules::execution::CameraFrame::Empty => {
                        String::new()
                    }
                },
                Err(e) => format!(r#"{{"error":"{}"}}"#, e.replace('"', "'")),
            };
            if !frame.is_empty() {
                if frame_tx.blocking_send(frame).is_err() { break; }
            }
            // Interval sleep with cancel check
            let deadline = std::time::Instant::now() + interval;
            while std::time::Instant::now() < deadline {
                if cancel2.load(std::sync::atomic::Ordering::Relaxed) { return; }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    });

    // Forward frames from blocking thread to WebSocket
    tokio::spawn(async move {
        while let Some(frame) = frame_rx.recv().await {
            ws_send(&tx2, &agent_id2, "camera.frame", &frame, None).await;
        }
    });

    ws_send(&tx, &agent_id, "camera.bind.result", r#"{"status":"streaming"}"#, rid).await;
}
