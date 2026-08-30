<div align="center">
  <img src="/assets/hero.png" width="600"/>
  <h1>Libra-Nextgen</h1>

  An open-source C2 (Command & Control) framework for enterprise red-team operations

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

Libra-Nextgen is an open-source, cross-platform adversary emulation / red team framework for enterprise security testing. It consists of three parts: a lightweight Agent written in Rust, an ASP.NET Core server, and a React web console. The Agent uses a **Bootstrapper + cloud modules** architecture — a minimal kernel handles communication and scheduling, everything else (files, credentials, recon, shell, etc.) is downloaded on demand from the server and executed in memory. Nothing touches disk.

Agents communicate with the server over HTTP(S) and WebSocket, with AES-256-GCM end-to-end encryption. A plugin system extends it with zip-delivered capabilities: Agent-side JavaScript (QuickJS sandbox) or native modules, server-side scripts, and frontend pages.

## Features

- HTTP(S) / WebSocket dual-channel, AES-256-GCM end-to-end encryption, RSA dynamic key negotiation
- Configurable traffic-masquerading profiles (paths / headers / UA)
- In-memory module loading, nothing touches disk (Bootstrapper + cloud modules)
- Concurrent task processing, interactive shell
- Indirect syscalls and sleep obfuscation
- Anti-sandbox / anti-VM
- System, hardware and network fingerprinting (GeoIP)
- Credential harvesting (browser passwords, RDP, SSH keys, etc.)
- SOCKS proxy and intranet web browsing
- In-memory PowerShell (CLR host)
- Multi-vector persistence
- Plugin system: upload zip / Git import / plugin market
- Online payload building (Builder), Windows / Linux
- Built-in AI assistant Justitia (tiered authority + tool-call audit)
- AI channels: command Justitia from IM — Telegram / Feishu Lark / WeChat iLink
  (one-time bind codes + deep-link binding, inline-button approvals, menu commands, group calls)
- Built-in MCP server (Streamable HTTP)
- Collaborative web console (realtime sync, audit logs)

## Getting Started

Requires MongoDB 7.0+, .NET SDK 10, Node.js 20+ (Rust 1.80+ is only needed to build Agent payloads). See the [Deployment Manual](docs/deployment.md).

```bash
# Start the server (port 5270)
cd src/service
dotnet run

# Start the console (port 5173)
cd src/webapp
npm install
npm run dev
```

Open <http://localhost:5173> — the first visit creates the admin account. Agent payloads can be built online in the Console's Builder page.

## Platform Support

| Platform | Status |
| --- | --- |
| Windows x64 | Supported (primary platform, fully verified) |
| Linux x64 | Cross-compilation passes; runtime verification pending |
| Windows x86 | Unsupported |

See the [platform support matrix](docs/platform-support.md).

## Docs

- [Plugin Development](docs/zh/plugin-development.md) — meta.json contract, zip layout, JS / native channels
- [Deployment Manual](docs/deployment.md) — MongoDB auth, nginx/TLS, Builder & cloud modules
- [Operations](docs/zh/operations.md) — Agent onboarding, plugin installs, Shell / files / MCP, audit & risk policy
- [LLM Plugin Guide](docs/llm-plugin-development.md)

## Related Repositories

- [Libra-Plugin-Template](https://github.com/SmaZone2020/Libra-Plugin-Template) — plugin development scaffold
- [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) — official plugin repository (plugin market install source)

## License

GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>

## Disclaimer

Authorized use only — assessments of your own assets, red-team engagements with signed rules of engagement, and isolated lab environments. Unauthorized access to any system, network or data is strictly prohibited.
