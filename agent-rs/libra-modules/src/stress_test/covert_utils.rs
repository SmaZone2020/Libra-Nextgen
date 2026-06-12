use rand::Rng;

pub struct CovertUtils;

static USER_AGENTS: &[&str] = &[
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edge/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
];

static REFERERS: &[Option<&str>] = &[
    Some("https://www.google.com/"),
    Some("https://www.bing.com/"),
    Some("https://duckduckgo.com/"),
    Some("https://www.baidu.com/"),
    Some("https://github.com/"),
    Some("https://stackoverflow.com/"),
    None,
];

static ACCEPT_LANGUAGES: &[&str] = &[
    "en-US,en;q=0.9",
    "zh-CN,zh;q=0.9,en;q=0.8",
    "ja-JP,ja;q=0.9,en;q=0.8",
    "ko-KR,ko;q=0.9,en;q=0.8",
    "de-DE,de;q=0.9,en;q=0.8",
    "fr-FR,fr;q=0.9,en;q=0.8",
];

impl CovertUtils {
    pub fn random_user_agent() -> &'static str {
        let mut rng = rand::thread_rng();
        let idx = rng.gen_range(0..USER_AGENTS.len());
        USER_AGENTS[idx]
    }

    pub fn random_referer() -> Option<&'static str> {
        let mut rng = rand::thread_rng();
        let idx = rng.gen_range(0..REFERERS.len());
        REFERERS[idx]
    }

    pub fn random_accept_language() -> &'static str {
        let mut rng = rand::thread_rng();
        let idx = rng.gen_range(0..ACCEPT_LANGUAGES.len());
        ACCEPT_LANGUAGES[idx]
    }

    pub fn random_jitter(base_ms: u64, jitter_pct: f64) -> u64 {
        let mut rng = rand::thread_rng();
        let range = (base_ms as f64 * jitter_pct) as u64;
        let delta = if range > 0 {
            rng.gen_range(0..(range * 2))
        } else {
            0
        };
        base_ms.saturating_sub(range).saturating_add(delta)
    }

    pub fn random_payload(min_size: usize, max_size: usize) -> Vec<u8> {
        let mut rng = rand::thread_rng();
        let size = if max_size > min_size {
            rng.gen_range(min_size..=max_size)
        } else {
            min_size
        };
        let mut buf = vec![0u8; size];
        rng.fill(&mut buf[..]);
        buf
    }

    pub fn random_source_port() -> u16 {
        rand::thread_rng().gen_range(1025..65535)
    }

    pub fn random_tcp_window() -> u16 {
        rand::thread_rng().gen_range(1024..65535)
    }
}
