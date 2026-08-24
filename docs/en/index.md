# Libra-Nextgen Overview

A modern **C2 (Command & Control) framework** for enterprise red-team operations: Rust Agent + ASP.NET Core Server + React/HeroUI Console.

## Architecture

| Component | Directory | Stack |
|-----------|-----------|-------|
| **Libra-Agent** | `src/agent-rs/` | Rust · Tokio · Win32 FFI · concurrent task processing |
| **Libra-Server** | `src/service/` | ASP.NET Core 10 · MongoDB · JWT |
| **Libra-Console** | `src/webapp/` | React 19 · HeroUI 3 · Vite |

The Agent is a **Bootstrapper + cloud modules** architecture: the kernel keeps only comm / crypto / scheduling / streaming; files, credentials, recon, shell, PowerShell, proxy are delivered as modules downloaded on demand and executed in memory (zero disk). A **plugin system** (zip packages) covers custom capabilities — Rhai scripts (no compiler) or native `cdylib` on the Agent, runtime page registration on the frontend.

## Communication

- **HTTP(S) polling**: register / heartbeat / task pull / result submit
- **WebSocket**: realtime messages (shell, streaming, tasks)
- **Crypto**: RSA dynamic negotiation of an AES-256-GCM session key; messages are refused without a session key (no plaintext fallback)
- **Module download**: per-need, session-key encrypted, in-memory loading

## Agent Concurrency

Each inbound WS message is handled by its own task; modules run lock-free (`prepare` to load, then lock-free `execute_module`), so long-running tasks never block receiving, heartbeat, or other tasks.

## Quick Start

Requirements: Rust 1.80+ · .NET SDK 10 · Node.js 20+ · MongoDB 7.0+.

```bash
# 1. Server (http://localhost:5270)
cd src/service && dotnet run
# 2. Console (http://localhost:5173; create admin on first /setup visit)
cd src/webapp && npm install && npm run dev
# 3. Build Win/Linux payloads from the Console Builder page (zig needed for cross-builds)
```

Three plugin entry points: **Upload** (zip) / **Import from Git** (a Git URL) / **Plugin Market** (Libra-Plugins, one-click install).

## More Docs

- [Plugin Development](plugin-development.md) — meta.json contract, zip layout, Rhai/native channels, frontend, samples
- [Deployment & Building](deployment.md) — Server/Console setup, Builder, cross-compile, plugin staging
- [Operations](operations.md) — Agent onboarding, plugin installs, Shell/files/MCP, audit & risk policy

## License

GNU General Public License v3.0. Authorized use only; unauthorized access is strictly prohibited.