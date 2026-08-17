use base64::Engine;
use std::sync::OnceLock;

/// Makes HTTP requests on behalf of the server (proxy browser).
pub struct ProxyBrowser;

impl ProxyBrowser {
    pub async fn fetch(
        url: &str,
        method: &str,
        headers_json: Option<&str>,
        body_base64: Option<&str>,
    ) -> String {
        let client = shared_client();

        let http_method = match method.to_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            "PATCH" => reqwest::Method::PATCH,
            "HEAD" => reqwest::Method::HEAD,
            "OPTIONS" => reqwest::Method::OPTIONS,
            _ => reqwest::Method::GET,
        };

        let mut req = client.request(http_method, url);

        // Add custom headers
        if let Some(hdrs) = headers_json {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(hdrs) {
                if let Some(obj) = json.as_object() {
                    for (key, val) in obj {
                        if key.eq_ignore_ascii_case("Host")
                            || key.eq_ignore_ascii_case("Cookie")
                            || key.eq_ignore_ascii_case("Content-Length")
                            || key.eq_ignore_ascii_case("Accept-Encoding")
                        {
                            continue;
                        }
                        if let Some(v) = val.as_str() {
                            req = req.header(key.as_str(), v);
                        }
                    }
                }
            }
        }

        // Add body
        if let Some(b64) = body_base64 {
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) {
                req = req.body(bytes);
            }
        }

        match req.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let final_url = resp.url().to_string();
                let content_type = resp
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("application/octet-stream")
                    .to_string();

                // Collect headers
                let header_parts: Vec<String> = resp
                    .headers()
                    .iter()
                    .filter(|(k, _)| !k.as_str().eq_ignore_ascii_case("content-encoding"))
                    .map(|(k, v)| {
                        format!(
                            r#""{}":["{}"]"#,
                            escape(k.as_str()),
                            escape(
                                &v.to_str()
                                    .unwrap_or("")
                                    .replace('\\', "\\\\")
                                    .replace('"', "\\\"")
                            )
                        )
                    })
                    .collect();

                match resp.bytes().await {
                    Ok(body_bytes) => {
                        let body_b64 =
                            base64::engine::general_purpose::STANDARD.encode(&body_bytes);
                        format!(
                            r#"{{"status":{},"statusText":"","headers":{{{}}},"body":"{}","contentType":"{}","url":"{}"}}"#,
                            status,
                            header_parts.join(","),
                            escape(&body_b64),
                            escape(&content_type),
                            escape(&final_url),
                        )
                    }
                    Err(e) => format!(r#"{{"error":"{}"}}"#, escape(&e.to_string())),
                }
            }
            Err(e) => {
                if e.is_timeout() {
                    r#"{"error":"Request timed out"}"#.to_string()
                } else {
                    format!(r#"{{"error":"{}"}}"#, escape(&e.to_string()))
                }
            }
        }
    }
}

fn shared_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(30))
            .danger_accept_invalid_certs(true)
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            )
            .build()
            .expect("failed to build proxy client")
    })
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
