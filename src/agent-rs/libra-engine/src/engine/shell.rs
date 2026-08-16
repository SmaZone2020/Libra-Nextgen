use serde_json::Value;

use libra_common::protocol::WebSocketMessage;
use libra_comm::ws::WsSender;
use libra_platform::get_executor;

use super::utils::{send_via_channel, ws_send};

pub(crate) struct ShellSession {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
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
        s.child.kill().await.ok();
    }

    let handle = get_executor().start_interactive_shell();
    let mut child = handle.child;
    let cancel_tx = handle.cancel_tx;

    let stdin = match child.stdin.take() {
        Some(s) => s,
        None => {
            ws_send(ws_tx, agent_id, "shell.error", r#"{"error":"Cannot open stdin"}"#, rid).await;
            return;
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    spawn_output_reader(stdout, stderr, cancel_tx.clone(), shell_tx, agent_id);

    *shell_session = Some(ShellSession { child, stdin, cancel_tx });
    ws_send(ws_tx, agent_id, "shell.lock.acquired", r#"{"status":"bound"}"#, rid).await;
}

pub(crate) async fn unbind_shell(
    agent_id: &str,
    ws_tx: &WsSender,
    shell_session: &mut Option<ShellSession>,
    rid: Option<&str>,
) {
    if let Some(mut s) = shell_session.take() {
        let _ = s.cancel_tx.send(true);
        s.child.kill().await.ok();
    }
    ws_send(ws_tx, agent_id, "shell.lock.released", r#"{"status":"unbound"}"#, rid).await;
}

pub(crate) async fn handle_shell_input(
    shell_session: &mut Option<ShellSession>,
    data: &Option<Value>,
    shell_tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
    agent_id: &str,
) {
    if let Some(ref mut s) = shell_session {
        if let Some(input) = data.as_ref().and_then(|d| d["text"].as_str()) {
            // Detect Ctrl+C (0x03) — kill current shell and restart
            if input.contains('\x03') {
                eprintln!("[shell] Ctrl+C detected, restarting shell");
                let _ = s.cancel_tx.send(true);
                let _ = s.child.kill().await;

                // Restart shell
                let handle = get_executor().start_interactive_shell();
                let mut child = handle.child;
                let cancel_tx = handle.cancel_tx;
                if let Some(stdin) = child.stdin.take() {
                    let stdout = child.stdout.take();
                    let stderr = child.stderr.take();
                    spawn_output_reader(stdout, stderr, cancel_tx.clone(), shell_tx, agent_id);

                    *shell_session = Some(ShellSession { child, stdin, cancel_tx });
                }
            } else {
                use tokio::io::AsyncWriteExt;
                let _ = s.stdin.write_all(input.as_bytes()).await;
            }
        }
    }
}

// ── Output reader ─────────────────────────────────────────────────────

/// Spawn a task that forwards shell stdout/stderr to the server via the
/// shell channel, until the shell is cancelled or the pipes close.
fn spawn_output_reader(
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    cancel_tx: tokio::sync::watch::Sender<bool>,
    shell_tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
    agent_id: &str,
) {
    let mut cancel_rx = cancel_tx.subscribe();
    let s_tx = shell_tx.clone();
    let aid = agent_id.to_string();

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
                                    let text = libra_platform::decode_shell_bytes(&out_buf[..n]);
                                    let json = serde_json::json!({"text": text}).to_string();
                                    let _ = send_via_channel(&s_tx, &aid, "shell.output", &json, None);
                                }
                                Err(_) => break,
                            }
                        }
                        r = err.read(&mut err_buf) => {
                            match r {
                                Ok(0) => break,
                                Ok(n) => {
                                    let text = libra_platform::decode_shell_bytes(&err_buf[..n]);
                                    let json = serde_json::json!({"text": text}).to_string();
                                    let _ = send_via_channel(&s_tx, &aid, "shell.output", &json, None);
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
                                    let text = libra_platform::decode_shell_bytes(&out_buf[..n]);
                                    let json = serde_json::json!({"text": text}).to_string();
                                    let _ = send_via_channel(&s_tx, &aid, "shell.output", &json, None);
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
}
