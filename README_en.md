# Libra-Nextgen

A modern C2 (Command & Control) framework for enterprise red-team operations.

## Architecture

| Component | Directory | Stack |
|-----------|-----------|-------|
| **Libra-Agent** | `src/agent-rs/` | Rust · Tokio · Win32 FFI |
| **Libra-Server** | `src/service/` | ASP.NET Core 10 · MongoDB · JWT |
| **Libra-Console** | `src/webapp/` | React 19 · HeroUI 3 · Vite |

The Agent uses a **Bootstrapper + cloud modules** architecture: the loader reflectively loads an encrypted minimal kernel (comm / crypto / scheduling / streaming), while everything else (files, credentials, recon, shell, PowerShell, proxy) is delivered as standalone modules downloaded on demand from the Server and executed in memory — nothing touches disk.

## Core Features

- **Communication**: dual-mode HTTP(S) polling + WebSocket, AES-256-GCM end-to-end encryption, RSA dynamic key negotiation
- **Stealth**: anti-sandbox / anti-VM probes, PEB spoofing, UAC elevation, multi-vector persistence (registry / scheduled tasks / cron / systemd)
- **Recon**: system & hardware fingerprinting, network + GeoIP, WiFi / LAN / Bluetooth scanning, processes / windows / local accounts
- **Credentials**: browser passwords (Chrome/Edge v10/v20), RDP credentials, SSH keys, QQ/WeChat data, QQ clientkey (jump exchange to skey/bkn), AI key scanning
- **Execution**: interactive Shell (xterm.js), in-memory PowerShell, live screen / webcam / microphone streaming
- **Files**: paged browsing, streaming download (live progress & speed), upload, in-archive browsing, timestomping
- **MCP**: built-in MCP server — AI clients can drive every C2 capability

## Quick Start

Requirements: Rust 1.80+, .NET SDK 10, Node.js 20+, MongoDB 7.0+.

### Deploy on Windows

```powershell
# 1. Start Server (http://localhost:5270)
cd src\service
dotnet run

# 2. Start Console (http://localhost:5173; create the admin on first visit to /setup)
cd src\webapp
npm install
npm run dev
```

Build payloads from the Console **Builder** page:

- **Win x64 / Win x86**: native MSVC (needs VS Build Tools + Rust MSVC toolchain)
- **Linux x64**: cross-compiled (server drives the zig toolchain automatically):

```powershell
cargo install cargo-zigbuild
# download zig (https://ziglang.org/download) and add it to PATH
```

### Deploy on Linux

```bash
# 1. Start Server (http://localhost:5270)
cd src/service
dotnet run

# 2. Start Console (http://localhost:5173; create the admin on first visit to /setup)
cd src/webapp
npm install
npm run dev
```

Build payloads from the Console **Builder** page:

- **Linux x64**: native build (default rustc toolchain)
- **Win x64 / Win x86**: cross-compiled (GNU ABI, also via the zig toolchain):

```bash
cargo install cargo-zigbuild   # required for Windows cross-builds
# download zig (https://ziglang.org/download) and add it to PATH
```

> Whether the Server runs on Windows or Linux, it can build both Windows and Linux payloads. Cross-compilation is detected automatically by the server (cargo-zigbuild + zig); a clear error is shown when the toolchain is missing. Plain `cargo build --release` on the CLI only produces payloads for the host platform.

## MCP

Endpoint `http://localhost:5270/mcp` (Streamable HTTP). Authenticate with an AccessKey (`Authorization: Bearer lnk_xxx`) created in the Console settings page or via API. Tool inventory: `GET /api/mcp/info`.

## License

GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>

## Disclaimer

This software is **authorized-use only** (assessments of your own assets, red-team engagements with signed rules of engagement, isolated lab research, sanctioned vulnerability validation). **Unauthorized access to any system, network or data is strictly prohibited.** Users must comply with all applicable laws and regulations.
