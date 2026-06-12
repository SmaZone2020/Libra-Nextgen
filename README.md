# Libra-Nextgen

[简体中文](README_zh.md)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**Libra-Nextgen** is a modern enterprise-grade Command & Control (C2) framework purpose-built for red-team operations, authorized penetration testing, and cybersecurity research. It provides a full-spectrum post-exploitation toolkit with a high-performance, low-observable architecture spanning three layers: agent, server, and web-based multi-operator console.

> **Project Home:** https://github.com/SmaZone2020/Libra-Nextgen

---

## Overview

Libra-Nextgen follows a classic three-tier C2 architecture designed for high availability and concurrent operator access:

- **Libra-Agent** — Lightweight, cross-platform, in-memory implant with modular plugin loading.
- **Libra-Server** — ASP.NET Core WebAPI + WebSocket hub managing agent communication, task dispatch, and data persistence.
- **Libra-Console** — React-based multi-operator web console with real-time collaboration, interactive terminal, and rich data visualization.

All agent-server communication is encrypted with AES-256-GCM (key exchange via RSA), and the server enforces JWT + RBAC authentication for console operators.

---

## Architecture

```
┌──────────────────┐       WebSocket / REST        ┌──────────────────┐
│  Libra-Console   │ ◄──────────────────────────►  │  Libra-Server    │
│  (React Web UI)  │     JWT-auth, RBAC            │  (ASP.NET Core)  │
│                  │     Real-time state sync       │                  │
│  Multi-operator  │                                │  MongoDB         │
│  Collaborative   │                                │  Audit Logs      │
└──────────────────┘                                └────────┬─────────┘
                                                             │
                                                AES-256-GCM  │  WebSocket
                                                + RSA KEX    │  / HTTP(S)
                                                             │
                                                  ┌──────────┴──────────┐
                                                  │  Libra-Agent         │
                                                  │  (.NET Native AOT)   │
                                                  │                      │
                                                  │  In-memory plugins   │
                                                  │  No disk writes      │
                                                  └─────────────────────┘
```

---

## Capabilities

### Agent — Implant

| Category           | Features                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Communication**  | HTTP(S) polling + WebSocket long-connection; Malleable C2 profiles; User-Agent rotation; proxy-aware                  |
| **Cross-Platform** | Windows + Linux; Native AOT compilation; unified `IExecutor` over Win32 P/Invoke and Linux syscalls                   |
| **Recon**          | System fingerprinting; domain enumeration (LDAP/RPC); Wi-Fi AP scanning; hardware & battery profiling; GeoIP location |
| **Anti-Analysis**  | VM/sandbox detection; CPU/memory/disk timing checks; mouse-movement heuristic; self-destruct on high-risk environment |
| **Execution**      | Interactive PTY (Linux) and PowerShell Runspace (Windows); in-memory .NET assembly loading; no disk writes            |
| **Credentials**    | LSASS memory dump; SAM extraction; browser password harvesting; token theft & impersonation                           |
| **Persistence**    | Registry Run keys; Scheduled Tasks (Windows); Crontab / systemd services (Linux); WMI event subscriptions             |
| **Pivoting**       | SOCKS4/5 proxy; port forwarding (RDP, SSH, etc.)                                                                      |
| **File Ops**       | Chunked upload/download with resume; timestomping; NTFS ADS traversal                                                 |
| **Surveillance**   | Differential screen capture; webcam snapshot (DirectShow/Media Foundation)                                            |

### Server — Backend

- ASP.NET Core 10 WebAPI with Kestrel
- Raw WebSocket message routing (Agent ↔ Console relay)
- JWT (RS256) authentication with RBAC (`Admin` / `Operator`)
- MongoDB document storage for agent metadata, task results, and audit logs
- Multi-listener deployment support (CDN/VPS distribution)
- Malleable C2 profile engine for HTTP traffic shaping

### Console — Frontend

- React 19 + TypeScript + Vite 6
- HeroUI3 Pro component library + Tailwind CSS v4
- Interactive web terminal (xterm.js + WebSocket PTY)
- Virtual scrolling for large datasets (@tanstack/react-virtual)
- Real-time operator collaboration via WebSocket state sync
- ECharts-powered dashboard with agent geo-map
- Multi-point DDoS stress testing module (8 attack vectors)
- Immutable audit log viewer (no-delete design)
- i18n: English / Chinese

---

## Tech Stack

| Layer                 | Technology                                             |
| --------------------- | ------------------------------------------------------ |
| **Agent Runtime**     | .NET 10 Native AOT                                     |
| **Server Framework**  | ASP.NET Core 10 WebAPI                                 |
| **Database**          | MongoDB 7+                                             |
| **Real-time**         | System.Net.WebSockets (raw, no SignalR)                |
| **Auth**              | JWT RS256 + BCrypt                                     |
| **Cryptography**      | AES-256-GCM + RSA key exchange                         |
| **Console Framework** | React 19 + TypeScript 5.8                              |
| **Build Tool**        | Vite 6                                                 |
| **Styling**           | Tailwind CSS v4 + tailwind-variants                    |
| **UI Components**     | HeroUI3 Pro (60+ components)                           |
| **Charts**            | Recharts + ECharts                                     |
| **Terminal**          | xterm.js                                               |
| **I18n**              | react-i18next                                          |
| **Common Library**    | .NET 10 Class Library (shared models, enums, protocol) |

---

## Quick Start

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Node.js](https://nodejs.org/) 22+ (LTS)
- [MongoDB](https://www.mongodb.com/try/download/community) 7.0+

### 1. Clone the Repository

```bash
git clone https://github.com/SmaZone2020/Libra-Nextgen.git
cd Libra-Nextgen
```

### 2. Start MongoDB

```bash
mongod --dbpath ./data
```

Or use Docker:

```bash
docker run -d -p 27017:27017 --name mongodb mongo:7
```

### 3. Start the Server

```bash
cd src
dotnet restore service.sln
dotnet build service.sln

cd service
dotnet run
```

The server starts on `http://localhost:5000`. Configure your MongoDB connection string in `src/service/appsettings.json` if needed:

```json
{
  "MongoDB": {
    "ConnectionString": "mongodb://localhost:27017",
    "DatabaseName": "libra_nextgen"
  }
}
```

### 4. Start the Web Console

```bash
cd src/webapp
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. On first access, you'll be prompted to create an initial admin account.

### 5. Deploy an Agent

For development (with .NET runtime):

```bash
cd src/agent
dotnet run -- --server http://localhost:5000/agent
```

For production Native AOT deployment:

```bash
# Linux x64
dotnet publish -c Release -r linux-x64

# Windows x64
dotnet publish -c Release -r win-x64
```

The compiled native binary (~1-2 MB) requires no .NET runtime on the target. The agent will register with the server and appear in the dashboard.

---

## How It Works

### Agent Lifecycle

1. **Staging** — Agent binary is compiled with embedded server address and RSA public key. Native AOT produces a standalone executable with no CLR dependency.
2. **First Contact** — Agent connects to server via WebSocket, performs RSA key exchange to negotiate an AES-256-GCM session key. Registers its fingerprint (hostname, OS, hardware profile, GeoIP).
3. **Task Loop** — Agent listens on the WebSocket channel for task commands. Tasks are dispatched by operators through the console, relayed by the server, and executed in-memory on the agent.
4. **Plugin Loading** — Advanced modules (credential dumping, pivoting, etc.) are downloaded as encrypted .NET assemblies and loaded via `Assembly.Load()` — never touching disk.
5. **Status Reporting** — Agent periodically reports heartbeat, task results, and any state changes. All output streams back to the console in real time.

### Communication Security

- **Key Exchange**: RSA-2048 on first connection. The agent encrypts a random session key with the server's public key.
- **Session Encryption**: AES-256-GCM for all subsequent messages. Each message includes a monotonic counter to prevent replay.
- **Traffic Shaping**: Malleable C2 profiles transform HTTP headers, URI paths, and body encoding to mimic legitimate API traffic (e.g., fake REST endpoints, JWT-looking tokens in headers, base64-encoded image metadata).

### Multi-Operator Design

The console is designed for team-based red-team exercises:

- Operators log in with individual accounts (JWT tokens with RBAC roles).
- All operator actions are broadcast via WebSocket — if Operator A opens a shell, Operator B sees it appear in real time.
- All commands are immutably logged to MongoDB's `AuditLogs` collection. The audit log viewer has no delete functionality, ensuring objective post-engagement review.

---

## Project Structure

```
Libra-Nextgen/
├── README.md
├── CLAUDE.md                          # Internal design document
└── src/
    ├── LibraNextgen.Common/           # Shared models, enums, protocol constants
    │   ├── Models/
    │   │   ├── Enums.cs               # CommandType, CampaignStatus, etc.
    │   │   ├── StressTestCampaign.cs   # DDoS campaign & agent status models
    │   │   └── StressConfig.cs        # Attack configuration DTO
    │   └── Protocol/
    │       └── WebSocketMessage.cs     # WsMessageType constants & routing
    │
    ├── agent/                         # Libra-Agent (implant)
    │   ├── Core/
    │   │   └── AgentEngine.cs         # Main loop, WS handler, task dispatch
    │   └── Modules/
    │       ├── StressTest/            # DDoS attack modules (8 methods)
    │       │   ├── DDoSModule.cs      # Orchestration engine
    │       │   ├── IStressMethod.cs   # Attack interface
    │       │   ├── CovertUtils.cs     # Traffic obfuscation utilities
    │       │   ├── HttpFlood.cs
    │       │   ├── SynFlood.cs
    │       │   ├── UdpFlood.cs
    │       │   ├── IcmpFlood.cs
    │       │   ├── Slowloris.cs
    │       │   ├── TcpConnFlood.cs
    │       │   ├── ReflectionAmp.cs
    │       │   └── MalformedPacket.cs
    │       └── ...                    # Other post-exploitation modules
    │
    ├── service/                       # Libra-Server (TeamServer)
    │   ├── Controllers/
    │   │   ├── StressTestController.cs # DDoS campaign REST API
    │   │   └── ...
    │   ├── Services/
    │   │   ├── StressTestService.cs   # Campaign orchestration & status tracking
    │   │   ├── ConnectionManager.cs   # Agent WS connection registry
    │   │   └── ...
    │   ├── Hubs/
    │   │   └── WebSocketHandler.cs    # WS message routing (Agent ↔ Console)
    │   ├── Data/
    │   │   └── Repository.cs          # Generic MongoDB repository
    │   └── Program.cs
    │
    └── webapp/                        # Libra-Console (React frontend)
        └── src/
            ├── app/App.tsx            # Root: routes, layout, auth
            ├── config/site.ts         # Sidebar navigation & page registry
            ├── pages/
            │   ├── Dashboard/         # KPI cards, GeoMap, traffic charts
            │   ├── Agents/            # Agent list & detail panels
            │   ├── Shell/             # xterm.js interactive terminal
            │   ├── Explorer/          # Remote file browser
            │   ├── Screen/            # Screen capture viewer
            │   ├── Media/             # Camera & microphone monitor
            │   ├── System/            # System info, processes, credentials
            │   ├── Audit/             # Immutable audit log viewer
            │   ├── Builder/           # Agent payload generator
            │   ├── StressTest/        # Multi-point DDoS control panel
            │   └── About/             # License & legal information
            ├── api/                   # REST API client functions
            ├── ws/                    # WebSocket client & event bus
            ├── contexts/              # React contexts (auth, agent, etc.)
            ├── components/            # HeroUI Pro + custom components
            ├── i18n/locales/          # en.ts & zh.ts translations
            └── types/                 # TypeScript type definitions
```

---

## Stress Test Module

Libra-Nextgen includes a built-in **multi-point DDoS stress testing** module designed for internal infrastructure resilience validation. It leverages multiple connected agents to generate distributed attack traffic from diverse network vantage points.

### Attack Methods

| Layer | Method           | Description                                                  |
| ----- | ---------------- | ------------------------------------------------------------ |
| L4    | SYN Flood        | TCP SYN packet flood with randomized source IP/port          |
| L4    | UDP Flood        | High-volume UDP datagram flood with variable payload         |
| L4    | ICMP Flood       | ICMP Echo Request flood with burst parallelism               |
| L4    | Reflection Amp   | DNS ANY + NTP monlist amplification via open resolvers       |
| L7    | HTTP Flood       | HTTP GET/POST flood with UA/Cookie/Referer rotation          |
| L7    | Slowloris        | Slow HTTP header drip holding connections open               |
| L7    | TCP Conn Flood   | TCP connection exhaustion (idle connections)                 |
| L7    | Malformed Packet | Malformed TLS ClientHello, bad HTTP headers, garbage payload |

### Covert Features

- Random User-Agent rotation (50+ signatures)
- Request interval jitter (randomized timing)
- Random payload generation (variable size and content)
- Process name spoofing (svchost.exe / systemd-logind)
- All modules execute in-memory, never writing to disk

---

## Known Issues

### Browser Credential Extraction — NativeAOT Crypto Limitation

The browser credential extraction module (`BrowserStealer.cs`) supports reading saved passwords, cookies, and browsing history from Chrome, Edge, Brave, and Firefox. Chromium v10 (DPAPI-based) and v20 (app-bound, LSASS-impersonation-based) encryption schemes are supported.

**Current limitation:** In **Release / NativeAOT** builds (`PublishAot=true`), AES-GCM decryption of v10/v20 passwords and cookies throws `TypeInitializationException`. This is caused by the NativeAOT trimmer removing platform-specific cryptographic interop code that `AesGcm` and `Microsoft.Data.Sqlite` depend on. The standalone `BrowserDemo` project works correctly under JIT (`dotnet run`) and serves as the reference implementation.

**Workaround:** Use the Debug/JIT build of the agent for browser credential harvesting, or deploy the `BrowserDemo` standalone tool on the target machine.

---

## License

Libra-Nextgen is free software licensed under the **GNU General Public License v3.0** (GPL-3.0). You may redistribute and/or modify it under the terms of the GPL as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

See [GNU GPL v3](https://www.gnu.org/licenses/gpl-3.0.html) for the full license text.

---

## Disclaimer

Libra-Nextgen is designed **exclusively** for authorized enterprise security testing, red-team operations, and cybersecurity research within the user's own infrastructure. Any use of this software must comply with all applicable local, national, and international laws.

**Unauthorized access** to computer systems, networks, or data without explicit written authorization from the system owner is illegal. Users must obtain proper authorization before conducting any security assessment or penetration testing activity.

This tool is intended for use by **qualified cybersecurity professionals** who understand the legal and ethical implications of their actions. If you are unsure whether your intended use is lawful, consult with legal counsel before proceeding.

---

## Limitation of Liability

The developers, contributors, and distributors of Libra-Nextgen assume **no liability** for any direct, indirect, incidental, special, exemplary, or consequential damages (including but not limited to procurement of substitute goods or services, loss of use, data, or profits, or business interruption) arising from the use or inability to use this software.

Users assume **full and complete responsibility** for all actions taken using this software. The developers shall not be held liable for any claims, damages, or legal consequences resulting from the use, misuse, or abuse of Libra-Nextgen.

**By using Libra-Nextgen, you acknowledge that you have read, understood, and agreed to these terms. If you do not agree, you must not use this software.**
