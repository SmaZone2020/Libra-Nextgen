use libra_common::models::InjectedConfig;
use rand::Rng;

pub struct ConfigManager {
    pub server_url: String,
    pub register_path: String,
    pub heartbeat_path: String,
    pub result_path: String,
    pub web_socket_path: String,
    pub heartbeat_interval_ms: u64,
    pub jitter_percent: f64,
}

impl ConfigManager {
    pub fn load(args: &[String], injected: Option<InjectedConfig>) -> Self {
        let mut cfg = ConfigManager {
            server_url: "http://127.0.0.1:5270".into(),
            register_path: "/api/beacon/register".into(),
            heartbeat_path: "/api/beacon/heartbeat".into(),
            result_path: "/api/beacon/result".into(),
            web_socket_path: "/ws/agent".into(),
            heartbeat_interval_ms: 3000,
            jitter_percent: 0.2,
        };

        // Apply injected config first (embedded at build time)
        if let Some(ic) = injected {
            if !ic.server_url.is_empty() {
                cfg.server_url = ic.server_url;
            }
        }

        // CLI args override
        let mut i = 0;
        while i < args.len() {
            match args[i].as_str() {
                "--server" if i + 1 < args.len() => { i += 1; cfg.server_url = args[i].clone(); }
                "--register" if i + 1 < args.len() => { i += 1; cfg.register_path = args[i].clone(); }
                "--heartbeat" if i + 1 < args.len() => { i += 1; cfg.heartbeat_path = args[i].clone(); }
                "--result" if i + 1 < args.len() => { i += 1; cfg.result_path = args[i].clone(); }
                "--ws" if i + 1 < args.len() => { i += 1; cfg.web_socket_path = args[i].clone(); }
                _ => {}
            }
            i += 1;
        }

        cfg
    }

    pub fn register_url(&self) -> String { format!("{}{}", self.server_url, self.register_path) }
    pub fn heartbeat_url(&self) -> String { format!("{}{}", self.server_url, self.heartbeat_path) }
    pub fn result_url(&self) -> String { format!("{}{}", self.server_url, self.result_path) }

    pub fn ws_url(&self) -> String {
        let without_scheme = self.server_url
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        format!("ws://{}{}", without_scheme, self.web_socket_path)
    }

    pub fn get_jittered_interval(&self) -> u64 {
        let mut rng = rand::thread_rng();
        let jitter = (self.heartbeat_interval_ms as f64 * self.jitter_percent * (rng.gen::<f64>() * 2.0 - 1.0)) as i64;
        (self.heartbeat_interval_ms as i64 + jitter).max(500) as u64
    }
}
