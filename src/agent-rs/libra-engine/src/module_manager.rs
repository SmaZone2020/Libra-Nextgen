use std::collections::HashMap;

use libra_comm::http::HttpCommunicator;
use libra_load::{load_module, LoadedModule, ModuleMainFn};

const MODULE_OUTPUT_CAP: usize = 16 * 1024 * 1024; // 16 MB per module result

/// Cloud module loader — downloads, loads in memory, and invokes modules on
/// demand. Only the modules actually used by a session are ever downloaded.
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
    ) -> Self {
        Self {
            http: HttpCommunicator::new(server_url, register_path, heartbeat_path, result_path),
            agent_id,
            session_key,
            loaded: HashMap::new(),
        }
    }

    pub fn is_loaded(&self, name: &str) -> bool {
        self.loaded.contains_key(name)
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

        // Self-identification check: the downloaded artifact must claim to be
        // the requested module, otherwise a corrupted/mismatched download
        // would execute under the wrong name.
        if !module.name.is_empty() && module.name != name {
            eprintln!("[module] MISMATCH: requested '{name}', downloaded '{0}'", module.name);
            return Err(format!(
                "module content mismatch: requested '{name}', downloaded '{}'",
                module.name
            ));
        }

        self.loaded.insert(name.to_string(), module);
        Ok(())
    }

    /// Invoke a module by name with a JSON input, returning its JSON output.
    pub async fn run(&mut self, name: &str, input: &str) -> Result<String, String> {
        let (main, input) = self.prepare(name, input).await?;
        execute_module(main, &input).await
    }

    /// Download/load a module and resolve its entry point, returning the entry
    /// plus the owned input. The caller must NOT hold `&mut self` (or the
    /// module manager lock) while executing, so concurrent tasks can run
    /// different modules in parallel instead of serializing on the loader.
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

/// Execute a resolved module entry point on the blocking pool. No module
/// manager lock is held here, so independent tasks run their modules in
/// parallel.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_manager_starts_with_nothing_loaded() {
        let mgr = ModuleManager::new(
            "http://127.0.0.1:1",
            "/register",
            "/heartbeat",
            "/result",
            "agent-1".to_string(),
            None,
        );
        assert!(!mgr.is_loaded("shell"));
    }
}
