# Libra-Nextgen 文档

> 文档以**真实生产实现**为准。仓库边界:主仓库只含平台代码(服务端/控制台/Agent 内核),
> 插件源码在独立仓库 [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins)。
>
> **English**: [Documentation index](en/README.md)

## 快速导航

| 文档 | 语言 | 内容 |
|---|---|---|
| [README](../README.md) / [README_en](../README_en.md) | 中 / 英 | 项目总览、特性、快速开始 |
| [部署手册](deployment.md) / [en](en/deployment.md) | 中 / 英 | 环境变量、MongoDB、nginx/TLS、密钥、故障排查 |
| [操作手册](zh/operations.md) / [en](en/operations.md) | 中 / 英 | 首次登录、Agent 上线、Shell、文件、插件、MCP、审计 |
| [插件开发教程](zh/plugin-development.md) / [en](en/plugin-development.md) | 中 / 英 | 插件三层结构、meta.json 契约、Agent 双通道、HTML 页面 |
| [AI 频道(IM 接入)](zh/ai-channels.md) / [en](en/ai-channels.md) | 中 / 英 | Telegram / 微信 iLink / 飞书 Lark 接入设计与配置 |
| [平台支持矩阵](platform-support.md) / [en](en/platform-support.md) | 中 / 英 | 平台构建/运行实测记录 |
| [插件体系架构](plugins/README.md) / [en](plugins/en/README.md) | 中 / 英 | 仓库边界、运行时加载、加载协议 |
| [HTML 插件页面 SDK](plugins/html-plugin-sdk.md) / [en](plugins/en/html-plugin-sdk.md) | 中 / 英 | 插件页面 `window.Libra` SDK 契约 |

## 术语速览

| 术语 | 含义 |
|---|---|
| Console | 前端控制台(React SPA,端口 5173 / 生产同域反代) |
| Server / TeamServer | ASP.NET Core 服务端(端口 5270) |
| Agent | Rust 编写的被控端(beacon HTTP + SSE 事件流) |
| 插件 | zip 包(meta.json + module/ + service/ + page/ + assets/) |
| 页面 SDK | 注入式 `window.Libra`(插件 HTML 页面直接可用) |

## 常见入口

- 插件页面加载协议:`GET /api/plugins/{id}/page/manifest.json` → `kind: html` → 注入渲染
- 插件管理 API:`/api/plugins/manager/*`;插件动作:`/api/plugins/{pluginId}/{action}`
- 服务端脚本:`/api/plugin/{pluginId}/{fn}`(Roslyn 解析执行)
- MCP:`/mcp`(Streamable HTTP,AccessKey 鉴权)
