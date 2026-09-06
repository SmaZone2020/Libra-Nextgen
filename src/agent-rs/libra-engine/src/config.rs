use libra_common::models::InjectedConfig;

pub struct ConfigManager {
    pub server_url: String,
    pub register_path: String,
    pub heartbeat_path: String,
    pub result_path: String,
    pub web_socket_path: String,
    pub heartbeat_interval_ms: u64,
    pub jitter_percent: f64,
    pub beacon_secret: String,
    pub user_agents: Vec<String>,
    pub extra_headers: Vec<String>,
    pub path_suffixes: Vec<String>,
    pub server_public_key: String,
}

impl ConfigManager {
    pub fn load(args: &[String], injected: Option<InjectedConfig>) -> Self {
        let mut cfg = ConfigManager {
            server_url: "http://127.0.0.1:5270".into(),
            register_path: "/api/beacon/register".into(),
            heartbeat_path: "/api/beacon/heartbeat".into(),
            result_path: "/api/beacon/result".into(),
            web_socket_path: "/ws/agent".into(),
            heartbeat_interval_ms: 10000,
            jitter_percent: 0.2,
            beacon_secret: String::new(),
            user_agents: Vec::new(),
            extra_headers: Vec::new(),
            path_suffixes: Vec::new(),
            server_public_key: String::new(),
        };

        // Apply injected config first (embedded at build time)
        if let Some(ic) = injected {
            if !ic.server_url.is_empty() {
                cfg.server_url = ic.server_url;
            }
            if !ic.beacon_secret.is_empty() {
                cfg.beacon_secret = ic.beacon_secret;
            }
            if ic.heartbeat_interval_ms > 0 {
                cfg.heartbeat_interval_ms = ic.heartbeat_interval_ms;
            }
            if ic.jitter_percent > 0.0 {
                cfg.jitter_percent = ic.jitter_percent;
            }
            cfg.user_agents = ic.user_agents;
            cfg.extra_headers = ic.extra_headers;
            cfg.path_suffixes = ic.path_suffixes;
            cfg.server_public_key = ic.server_public_key;
        }

        // CLI args override
        let mut i = 0;
        while i < args.len() {
            match args[i].as_str() {
                "--server" if i + 1 < args.len() => {
                    i += 1;
                    cfg.server_url = args[i].clone();
                }
                "--register" if i + 1 < args.len() => {
                    i += 1;
                    cfg.register_path = args[i].clone();
                }
                "--heartbeat" if i + 1 < args.len() => {
                    i += 1;
                    cfg.heartbeat_path = args[i].clone();
                }
                "--result" if i + 1 < args.len() => {
                    i += 1;
                    cfg.result_path = args[i].clone();
                }
                "--ws" if i + 1 < args.len() => {
                    i += 1;
                    cfg.web_socket_path = args[i].clone();
                }
                _ => {}
            }
            i += 1;
        }

        cfg
    }

    pub fn register_url(&self) -> String {
        format!("{}{}", self.server_url, self.register_path)
    }
    pub fn heartbeat_url(&self) -> String {
        format!("{}{}", self.server_url, self.heartbeat_path)
    }
    pub fn result_url(&self) -> String {
        format!("{}{}", self.server_url, self.result_path)
    }

    pub fn ws_url(&self) -> String {
        let ws_scheme = if self.server_url.starts_with("https://") {
            "wss://"
        } else {
            "ws://"
        };
        let without_scheme = self
            .server_url
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        format!("{}{}{}", ws_scheme, without_scheme, self.web_socket_path)
    }

    pub fn get_jittered_interval(&self) -> u64 {
        x86_style_jitter(self.heartbeat_interval_ms, self.jitter_percent)
    }
}

pub fn x86_style_jitter(base_ms: u64, jitter_percent: f64) -> u64 {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let base = base_ms.max(500) as f64;

    if rng.gen_ratio(1, 12) {
        return (base * rng.gen_range(1.5..=3.0)) as u64;
    }

    let spread = base * jitter_percent.clamp(0.0, 0.9);
    let delta = if spread > 0.0 {
        rng.gen_range(-spread..=spread)
    } else {
        0.0
    };
    (base + delta).max(500.0) as u64
}
