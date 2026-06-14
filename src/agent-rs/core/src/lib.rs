//! Core DLL — contains all agent functionality.
//! Loaded reflectively by the loader, never touches disk.

use libra_common::models::InjectedConfig;

/// Entry point called by the reflective loader.
///
/// # Safety
/// `config_ptr` must point to valid UTF-8 JSON of length `config_len`.
#[no_mangle]
pub unsafe extern "system" fn core_main(config_ptr: *const u8, config_len: usize) {
    // Parse config JSON from raw pointer
    let config_json = if config_ptr.is_null() || config_len == 0 {
        "{}"
    } else {
        match std::str::from_utf8(std::slice::from_raw_parts(config_ptr, config_len)) {
            Ok(s) => s,
            Err(_) => "{}",
        }
    };

    let injected: InjectedConfig = match serde_json::from_str(config_json) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[core] Failed to parse config: {}", e);
            return;
        }
    };

    // Load config (injected + CLI args)
    let args: Vec<String> = std::env::args().collect();
    let cfg = libra_engine::config::ConfigManager::load(&args, Some(injected));

    // Build tokio runtime and run the agent engine
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("[core] Failed to create tokio runtime: {}", e);
            return;
        }
    };

    rt.block_on(async {
        let mut engine = libra_engine::engine::AgentEngine::new(cfg);
        if let Err(e) = engine.run().await {
            eprintln!("[core] Agent error: {}", e);
        }
    });
}
