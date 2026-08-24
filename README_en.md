# Libra-Nextgen

A modern **C2 (Command & Control) framework** for enterprise red-team operations: Rust Agent + ASP.NET Core Server + React/HeroUI Console.

## Architecture

| Component | Directory | Stack |
|-----------|-----------|-------|
| **Libra-Agent** | `src/agent-rs/` | Rust · Tokio · Win32 FFI · concurrent task processing |
| **Libra-Server** | `src/service/` | ASP.NET Core 10 · MongoDB · JWT |
| **Libra-Console** | `src/webapp/` | React 19 · HeroUI 3 · Vite |

The Agent uses a **Bootstrapper + cloud modules** architecture: the loader reflectively loads an encrypted minimal kernel (comm / crypto / scheduling / streaming), while everything else (files, credentials, recon, shell, PowerShell, proxy) is delivered as modules downloaded on demand from the Server and executed in memory — nothing touches disk. A **plugin system** extends it with zip-delivered capabilities: Agent-side Rhai scripts (no compiler) or native `cdylib`, and frontend runtime page registration.

## Quick Start

Requirements: Rust 1.80+ · .NET SDK 10 · Node.js 20+ · MongoDB 7.0+.

```bash
# 1. Server (http://localhost:5270)
cd src/service && dotnet run
# 2. Console (http://localhost:5173; create the admin on first visit to /setup)
cd src/webapp && npm install && npm run dev
# 3. Payloads: build Win/Linux payloads online from the Console Builder page
#    (cross-builds need the zig toolchain)
```

Three plugin channels: **Upload** (zip) / **Import from Git** (a Git URL) / **Plugin Market** (Libra-Plugins repo, one-click install — fetched directly from GitHub raw with a 1h browser cache).

## Core Features

- **Communication**: HTTP(S) polling + WebSocket, AES-256-GCM end-to-end encryption, RSA dynamic key negotiation
- **Agent**: concurrent task processing (modules run lock-free), interactive Shell (xterm.js/PTY), live screen / webcam / microphone streaming, anti-sandbox / anti-VM, multi-vector persistence
- **Recon**: system & hardware fingerprinting, network + GeoIP, WiFi / LAN / Bluetooth scanning, processes / windows / accounts
- **Credentials**: browser passwords, RDP credentials, SSH keys, WeChat data, AI tool API keys (plugin)
- **Plugin Market**: a standalone repo of zips + `index.json` (rebuilt by CI), one-click install/update from the Console
- **MCP**: built-in MCP server (Streamable HTTP) — AI clients can drive every C2 capability

## Docs

| Topic | Content |
| --- | --- |
| [Plugin Development](docs/en/plugin-development.md) | meta.json contract, zip layout, Rhai/native channels, frontend `usePluginHost`, sample plugins |
| [Deployment & Building](docs/en/deployment.md) | Server/Console setup, Builder, Win/Linux cross-compile, plugin module staging |
| [Operations](docs/en/operations.md) | Agent onboarding, market/upload/Git installs, Shell/files/MCP usage, audit & risk policy |

> Full docs are also published to the [GitHub Wiki](https://github.com/SmaZone2020/Libra-Nextgen/wiki) (zh + en).

## License

GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>

## Disclaimer

This software is **authorized-use only** (assessments of your own assets, red-team engagements with signed rules of engagement, isolated lab research, sanctioned vulnerability validation). **Unauthorized access to any system, network or data is strictly prohibited.** Users must comply with all applicable laws and regulations.