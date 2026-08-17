use std::io::{Read, Write};

use portable_pty::{Child, MasterPty, PtySize};
use serde_json::Value;

use libra_common::protocol::WebSocketMessage;
use libra_comm::ws::WsSender;
use libra_platform::get_executor;

use super::utils::{send_via_channel, ws_send};

pub(crate) struct ShellSession {
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    cancel_tx: tokio::sync::watch::Sender<bool>,
}

// ── Shell handlers ────────────────────────────────────────────────────

pub(crate) async fn bind_shell(
    agent_id: &str,
    ws_tx: &WsSender,
    shell_tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
    shell_session: &mut Option<ShellSession>,
    _data: &Option<Value>,
    rid: Option<&str>,
) {
    // Kill existing shell
    if let Some(mut s) = shell_session.take() {
        let _ = s.cancel_tx.send(true);
        s.child.kill().ok();
    }

    let handle = get_executor().start_interactive_shell();
    let mut child = handle.child;
    let cancel_tx = handle.cancel_tx;
    let writer = handle.writer;
    let master = handle.master;
    let reader = handle.reader;

    spawn_output_reader(reader, cancel_tx.clone(), shell_tx, agent_id);

    *shell_session = Some(ShellSession { child, writer, master, cancel_tx });
    ws_send(ws_tx, agent_id, "shell.lock.acquired", r#"{"status":"bound","mode":"write"}"#, rid).await;
}

pub(crate) async fn unbind_shell(
    agent_id: &str,
    ws_tx: &WsSender,
    shell_session: &mut Option<ShellSession>,
    rid: Option<&str>,
) {
    if let Some(mut s) = shell_session.take() {
        let _ = s.cancel_tx.send(true);
        s.child.kill().ok();
    }
    ws_send(ws_tx, agent_id, "shell.lock.released", r#"{"status":"unbound"}"#, rid).await;
}

/// Resize the PTY to match the client terminal geometry.
pub(crate) async fn resize_shell(
    shell_session: &mut Option<ShellSession>,
    data: &Option<Value>,
) {
    if let Some(ref mut s) = shell_session {
        let cols = data.as_ref().and_then(|d| d["cols"].as_u64()).unwrap_or(80) as u16;
        let rows = data.as_ref().and_then(|d| d["rows"].as_u64()).unwrap_or(24) as u16;
        let _ = s
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| eprintln!("[shell] resize failed: {e}"));
    }
}

pub(crate) async fn handle_shell_input(
    shell_session: &mut Option<ShellSession>,
    data: &Option<Value>,
    _shell_tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
    _agent_id: &str,
) {
    if let Some(ref mut s) = shell_session {
        if let Some(input) = data.as_ref().and_then(|d| d["text"].as_str()) {
            // PTY: forward raw bytes (incl. escape sequences, Ctrl+C handled
            // by the shell itself). Input is short — synchronous write is fine.
            let _ = s.writer.write_all(input.as_bytes());
            let _ = s.writer.flush();
        }
    }
}

// ── Output reader ─────────────────────────────────────────────────────

/// Spawn a blocking task that reads PTY output and forwards it to the server
/// via the shell channel, until the shell is cancelled.
fn spawn_output_reader(
    mut reader: Box<dyn Read + Send>,
    cancel_tx: tokio::sync::watch::Sender<bool>,
    shell_tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
    agent_id: &str,
) {
    let mut cancel_rx = cancel_tx.subscribe();
    let s_tx = shell_tx.clone();
    let aid = agent_id.to_string();

    tokio::task::spawn_blocking(move || {
        let mut buf = vec![0u8; 8192];
        loop {
            if *cancel_rx.borrow() {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if send_via_channel(&s_tx, &aid, "shell.output", &json_text(&text), None).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn json_text(text: &str) -> String {
    serde_json::json!({ "text": text }).to_string()
}
