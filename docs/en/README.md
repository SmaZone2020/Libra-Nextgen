# Libra-Nextgen Documentation

> **Correspondence**: English version of [`../README.md`](../README.md) (Chinese documentation index). Documentation is based on the **real production implementation**. Repository boundary: the main repository contains only the platform code (server / console / Agent kernel); plugin sources live in the standalone [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) repository.

## Quick Navigation

| Document | Language | Contents |
|---|---|---|
| [README](../README.md) / [README_en](../README_en.md) | zh / en | Project overview, features, quick start |
| [Deployment Manual](../deployment.md) / [en](deployment.md) | zh / en | Environment variables, MongoDB, nginx/TLS, keys, troubleshooting |
| [Operations Manual](../zh/operations.md) / [en](operations.md) | zh / en | First login, Agent onboarding, Shell, files, plugins, MCP, audit |
| [Plugin Development](../zh/plugin-development.md) / [en](plugin-development.md) | zh / en | Plugin three-layer structure, meta.json contract, Agent dual channels, HTML pages |
| [AI Channels (IM)](../zh/ai-channels.md) / [en](ai-channels.md) | zh / en | Telegram / WeChat iLink / Feishu Lark integration design & configuration |
| [Platform Support Matrix](../platform-support.md) / [en](platform-support.md) | zh / en | Verified platform build/runtime records |
| [Plugin Architecture](../plugins/README.md) | 中文 | Repository boundary, runtime loading, loading protocol |
| [HTML Plugin Page SDK](../plugins/html-plugin-sdk.md) | 中文 | `window.Libra` SDK contract for plugin pages |

> The plugin architecture and HTML plugin page SDK documents are currently Chinese-only; English versions are planned at `plugins/en/`.

## Terminology

| Term | Meaning |
|---|---|
| Console | Web console (React SPA, port 5173 / same-origin reverse proxy in production) |
| Server / TeamServer | ASP.NET Core server (port 5270) |
| Agent | Rust-based implant (beacon HTTP + SSE event stream) |
| Plugin | zip package (meta.json + module/ + service/ + page/ + assets/) |
| Page SDK | Injected `window.Libra` (directly usable by plugin HTML pages) |

## Common Entry Points

- Plugin page loading protocol: `GET /api/plugins/{id}/page/manifest.json` → `kind: html` → injected rendering
- Plugin management API: `/api/plugins/manager/*`; plugin actions: `/api/plugins/{pluginId}/{action}`
- Server scripts: `/api/plugin/{pluginId}/{fn}` (parsed & executed by Roslyn)
- MCP: `/mcp` (Streamable HTTP, AccessKey auth)
