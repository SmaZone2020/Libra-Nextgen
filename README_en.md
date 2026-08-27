<div align="center">
  <img src="/assets/hero.png" width="600"/>
  <h1>Libra-Nextgen</h1>

  
  A modern **C2 (Command & Control) framework** for enterprise red-team operations
  
  ![.NET](https://img.shields.io/badge/.NET-C172D7?style=flat-square&logo=.net&logoColor=black)
  ![Rust](https://img.shields.io/badge/Rust-FFFFFF?style=flat-square&logo=rust&logoColor=black)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
  ![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)
  ![HeroUI](https://img.shields.io/badge/HeroUI-000000?style=flat-square&logo=heroui&logoColor=white)
  ![MongoDB](https://img.shields.io/badge/MongoDB-21BF3E?style=flat-square&logo=mongodb&logoColor=white)
  
  ![Release](https://img.shields.io/github/v/release/SmaZone2020/Libra-Nextgen?style=flat-square)
  ![CI](https://github.com/SmaZone2020/Libra-Nextgen/actions/workflows/ci.yml/badge.svg)

  <p><a href="README.md">简体中文</a> | <b>English</b></p>

</div>



## Architecture

| Component | Directory | Stack |
|-----------|-----------|-------|
| **Agent** | `src/agent-rs/` | Rust · Tokio · Win32 FFI · concurrent task processing |
| **Server** | `src/service/` | ASP.NET Core 10 · MongoDB · JWT |
| **Console** | `src/webapp/` | React 19 · HeroUI 3 · Vite |

The Agent uses a **Bootstrapper + cloud modules** architecture: the loader reflectively loads an encrypted minimal kernel (`core.bin` — comm / crypto / scheduling / streaming), while everything else (files, credentials, recon, shell, PowerShell, proxy, token) is delivered as **modules** downloaded on demand from the Server and executed in memory — nothing touches disk. A **plugin system** extends it with zip-delivered capabilities: Agent-side **JavaScript (QuickJS sandbox, no compiler)** or native `cdylib`, server-side C# scripts, and frontend runtime page registration.

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

Plugin installation: **Upload** (zip) / **Import from Git** (e.g. the [plugin scaffold repo](https://github.com/SmaZone2020/Libra-Plugin-Template)) / **Plugin Market** (the [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) official repository, online install).

## Core Features

- **Communication**: HTTP(S) masquerading channel (OpenAI-style endpoints + SSE task event stream), AES-256-GCM end-to-end encryption, RSA dynamic key negotiation; Console realtime channel over WebSocket (30-second keepalive)
- **Traffic masquerading**: configurable profiles (comm path / headers / UA, etc.), persisted manage/disable in the Builder; connection parameters (protocol / heartbeat / jitter) injected at build time
- **Agent**: concurrent task processing (modules run lock-free), interactive Shell (xterm.js), indirect syscalls + sleep obfuscation, anti-sandbox / anti-VM, in-memory PowerShell (CLR host), multi-vector persistence
- **Recon**: system & hardware fingerprinting, network + GeoIP, WiFi / LAN / Bluetooth scanning, processes / windows / accounts
- **Credentials**: browser passwords, RDP credentials, SSH keys, WeChat data, AI tool API keys (plugin)
- **Proxy**: Socks proxy module + ProxyBrowser for browsing intranet web apps
- **Plugin system**: upload zip / Git import / Plugin Market with online install & update
- **Builder**: online Win/Linux payload builds, per-module enable switches, one-liner delivery (PowerShell/Cmd/Bash commands, LNK packaging, anonymous download links)
- **MCP**: built-in MCP server (Streamable HTTP at `/mcp`, toggleable) — AI clients can drive every C2 capability
- **Console**: ECharts dashboard (traffic charts/map), configurable backend address, reconnect handling, audit logs, risk policy

## Platform Support

| Platform | Status |
| --- | --- |
| Windows x64 | Supported (primary platform, fully verified) |
| Linux x64 | Cross-compilation passes; runtime verification pending |
| Windows x86 | Unsupported (no 32-bit indirect syscall implementation; disabled in Builder) |

See the [platform support matrix](docs/平台支持矩阵.md).

## Docs

| Topic | Content |
| --- | --- |
| [Plugin Development](docs/zh/插件开发.md) | meta.json contract, zip layout, JS/native channels, frontend `usePluginHost`, sample plugins |
| [Deployment Manual](docs/部署手册.md) | MongoDB auth, nginx/TLS, Builder, cloud modules & plugin staging |
| [Platform Support Matrix](docs/平台支持矩阵.md) | Per-platform verified records (build commands / results / conclusions) |
| [Operations](docs/zh/操作手册.md) | Agent onboarding, market/upload/Git installs, Shell/files/MCP usage, audit & risk policy |
| [LLM Plugin Guide](docs/LLM-插件开发指南.md) | Plugin development guide for LLMs |

## Related Repositories

| Repository | Description |
| --- | --- |
| [Libra-Plugin-Template](https://github.com/SmaZone2020/Libra-Plugin-Template) | Plugin development scaffold: `meta.json` contract + `module/` (Agent-side scripts) + `service/` (server-side C#) + `page/` (frontend page), one-click `npm run pack` |
| [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) | Official plugin repository: packaged zips under `plugins/<pluginId>/`, `index.json` rebuilt automatically by CI — the install source for the Console's Plugin Market |

## License

GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>

## Disclaimer

This software is **authorized-use only** (assessments of your own assets, red-team engagements with signed rules of engagement, isolated lab research, sanctioned vulnerability validation). **Unauthorized access to any system, network or data is strictly prohibited.** Users must comply with all applicable laws and regulations.
