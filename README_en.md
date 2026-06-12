# Libra-Nextgen

A modern C2 (Command & Control) framework for enterprise red-team operations.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Libra-Console (React 19)                     │
│       Operator Console · Multi-User Collaboration · Live        │
│                   http://localhost:5173                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ WebSocket / REST
┌──────────────────────────▼──────────────────────────────────────┐
│               Libra-Server (ASP.NET Core 10)                    │
│   Listener · Task Scheduler · MongoDB Persistence · JWT Auth    │
│                   http://localhost:5270                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP(S) / WebSocket (AES-256-GCM)
┌──────────────────────────▼──────────────────────────────────────┐
│                    Libra-Agent (Rust)                           │
│   Cross-Platform Payload · Modular Recon · In-Memory Execution  │
│         Anti-Sandbox · Persistence · Stealth OpSec             │
└─────────────────────────────────────────────────────────────────┘
```

### Subsystems

| Component | Directory | Stack |
|-----------|-----------|-------|
| **Agent** | `src/agent-rs/` | Rust 2021 · Tokio · Win32/WinRT FFI · `windows` crate |
| **Server** | `src/service/` | ASP.NET Core 10 · MongoDB · JWT (RSA) · WebSocket |
| **Console** | `src/webapp/` | React 19 · TypeScript · HeroUI 3 · Vite 6 · Tailwind CSS 4 |

### Agent Workspace (`src/agent-rs/`)

A Rust workspace of 6 crates:

| Crate | Purpose |
|-------|---------|
| `agent` | Standalone binary: config parsing, persistence, anti-analysis, main engine |
| `libra-common` | Shared models (`InjectedConfig`, `AgentTask`), protocol constants |
| `libra-crypto` | RSA-2048 + AES-256-GCM key negotiation and encryption |
| `libra-comm` | Dual-mode comms: HTTP polling + WebSocket long-lived connection |
| `libra-platform` | Hardware collection (CPU/GPU/RAM/disks/displays), WMI queries, `sysinfo` fallback |
| `libra-modules` | All operational modules (see capability matrix below) |

### Server Project (`src/service/`)

ASP.NET Core WebAPI with:
- `Controllers/` — 17 REST controllers (Agents, Tasks, Builder, Files, System, Media, Screen, StressTest, Proxy, Audit, etc.)
- `Services/` — 12 business services (AgentService, TaskService, AuthService, HeartbeatMonitor, etc.)
- `Hubs/` — WebSocket connection management (native WebSocket, not SignalR)
- `Middleware/` — Audit logging middleware
- `Profiles/` — Malleable C2 profiles (traffic camouflage)
- `Data/` — MongoDB context and generic repository

### Console Pages (`src/webapp/src/pages/`)

15 page modules:

| Page | Route | Function |
|------|-------|----------|
| Dashboard | `/` | Stats cards, traffic charts, agent geo-distribution map |
| Agents | `/agents` | Agent list, detail panel (hardware accordion), credential dump |
| Shell | `/shell` | Interactive remote terminal via xterm.js |
| ScreenMonitor | `/screen` | Screen diff streaming (64×64 block diff + keyframe) |
| MediaMonitor | `/media` | Camera / microphone live streaming |
| FileManager | `/files` | Remote file browser, upload, download, compression |
| System | `/system` | Processes, windows, environment variables, network, WiFi scan, LAN scan |
| SoftwareData | `/othersoft` | WeChat/QQ data, browser credentials (Chrome/Edge v10+v20), AI token scanner |
| ProxyBrowser | `/proxy` | Browse web pages through compromised proxy |
| Builder | `/builder` | Agent payload generation and compilation |
| StressTest | `/stress-test` | Multi-point DDoS attack management |
| AuditLogs | `/audit` | Operation audit log viewer |
| About | `/about` | License and legal disclaimers |

## Agent Capability Matrix

### Reconnaissance
- **System Fingerprint**: OS version, architecture, CPU, GPU, RAM, disk serial numbers, motherboard/BIOS
- **Network Intelligence**: Public IP, GeoIP (city/ISP/ASN/coordinates), proxy settings, DNS suffix
- **WiFi Scanning**: Win32 Wlan API (primary) + `netsh wlan show networks mode=bssid` regex fallback. Outputs SSID, BSSID, authentication, encryption, signal strength, band (2.4GHz / 5GHz / 6GHz)
- **LAN Scanning**: ARP table query + ICMP ping sweep
- **Bluetooth Scanning**: WinRT `BluetoothDevice.GetDeviceSelector` + `FindAllAsync`, BLE support
- **Process Enumeration**: CreateToolhelp32Snapshot + WMI fallback
- **Window Enumeration**: EnumWindows + window title collection
- **Local Accounts**: WMI `Win32_UserAccount`, SID-based admin group detection
- **Environment Variables**: System/user PATH read and edit
- **Browser Credentials**: Chrome/Edge v10 (DPAPI) and v20 (app-bound key via LSASS token impersonation → SYSTEM DPAPI → ChaCha20-Poly1305 decryption)
- **AI Token Scanner**: API key file scanning for common AI vendors
- **Third-Party Software**: WeChat wxid and file directories, QQ account data

### Execution
- **Shell**: CMD / PowerShell (Windows), Bash / Zsh (Linux)
- **File Operations**: Chunked upload/download, move, copy, delete, timestomping
- **Screen Capture**: Multi-monitor, 64×64 block diff streaming + JPEG keyframes via DXGI Desktop Duplication API
- **Camera**: WinRT `MediaCapture` + DirectShow low-level access
- **Microphone**: WinRT `MediaCapture` + WaveIn API
- **Credential Dump**: In-memory credential extraction
- **Proxy Browser**: Browse arbitrary URLs through the compromised host

### Stress Testing
- HTTP Flood · SYN Flood · UDP Flood · ICMP Flood
- Slowloris · Reflection Attack · Malformed Packets

### Anti-Analysis
- CPU core count · RAM size · Disk capacity baseline checks
- Sandbox bait username/hostname detection
- Hypervisor artifact detection (VMware/VirtualBox/Hyper-V)

### Persistence
- **Windows**: Registry Run key · Scheduled task (`schtasks /create /rl highest`) · ShellExecuteW + `runas` UAC elevation
- **Linux**: Crontab @reboot · systemd service

## Quick Start

### Prerequisites

- **Rust** 1.80+ (MSVC toolchain, Windows)
- **.NET SDK** 10.0+
- **Node.js** 20+
- **MongoDB** 7.0+ (default: `mongodb://localhost:27017`)

### 1. Start Server

```bash
cd src/service
dotnet run
# Listens on http://localhost:5270
# API docs: http://localhost:5270/scalar/v1
```

The database `libra_nextgen` and initial admin user are created on first launch.

### 2. Start Console

```bash
cd src/webapp
npm install
npm run dev
# Listens on http://localhost:5173
```

Open the browser, go to `/setup` to create an admin account, then log in.

### 3. Build Agent

```bash
cd src/agent-rs
cargo build --release
# Output: target/release/agent.exe
```

Alternatively, use the Builder page in Console to compile online with custom server address, communication parameters, and persistence options.

### 4. Deploy Agent

Deploy `agent.exe` to the target Windows host and execute. On startup:
1. If `requireAdmin` is set, request UAC elevation
2. If `copyToPath` is set, copy to the target directory and relaunch
3. If `enablePersistence` is set, install scheduled task / cron
4. Run anti-sandbox checks
5. Establish encrypted communication with Server and register online

## Config Injection

The Agent supports injected JSON configuration appended to the binary:

```
[Original PE data][CONFIG_MAGIC][4-byte LE length][JSON config]
```

The `InjectedConfig` model is defined in `libra-common/src/models.rs`:

```json
{
  "serverUrl": "http://192.168.1.100:5270",
  "registerPath": "/api/agentcomms/register",
  "heartbeatPath": "/api/agentcomms/heartbeat",
  "resultPath":  "/api/agentcomms/result",
  "heartbeatIntervalSecs": 5,
  "enablePersistence": true,
  "requireAdmin": true,
  "copyToPath": "Microsoft\\SecurityHealth"
}
```

## License

Libra-Nextgen is released under the **GNU General Public License v3.0 (GPL-3.0)**.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful for authorized security research and enterprise red-team operations, but **WITHOUT ANY WARRANTY**; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

Full license text: <https://www.gnu.org/licenses/gpl-3.0.html>

## Disclaimer

Libra-Nextgen may **only** be used in the following explicitly authorized scenarios:
- Security assessment of your own infrastructure or systems
- Red-team operations under a written Rules of Engagement (RoE)
- Cybersecurity research in isolated laboratory environments
- Authorized vulnerability verification within enterprise environments

**Unauthorized access** to any computer system, network, or data without explicit written authorization from the system owner is strictly prohibited. Users must comply with all applicable local, national, and international laws.
