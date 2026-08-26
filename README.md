# Libra-Nextgen

面向企业级红蓝对抗的现代化 **C2（Command & Control）框架**

![.NET](https://img.shields.io/badge/.NET-C172D7?style=flat-square&logo=.net&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-FFFFFF?style=flat-square&logo=rust&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)
![MongoDB](https://img.shields.io/badge/MongoDB-21BF3E?style=flat-square&logo=mongodb&logoColor=white)
![Release](https://img.shields.io/github/v/release/SmaZone2020/Libra-Nextgen?style=flat-square)
![CI](https://github.com/SmaZone2020/Libra-Nextgen/actions/workflows/ci.yml/badge.svg)

## 架构

| 组件 | 目录 | 技术栈 |
| --- | --- | --- |
| **Agent** | `src/agent-rs/` | Rust · Tokio · Win32 FFI · 多任务并发 |
| **Server** | `src/service/` | ASP.NET Core 10 · MongoDB · JWT |
| **Console** | `src/webapp/` | React 19 · HeroUI 3 · Vite |

Agent 采用 **Bootstrapper + 云载模块**：loader 反射加载加密最小内核 `core.bin`（通信/加密/调度/流式），文件、凭据、侦查、Shell、PowerShell、代理、Token 等能力全部作为**模块**按需从 Server 下载、内存加载、**零落盘**。**插件体系**（zip 包交付）覆盖自定义能力——Agent 端 **JavaScript（QuickJS 沙箱，免编译）** / native `cdylib` 双通道，服务端 C# 脚本，前端运行时注册页面。

**零 WS 架构**：Agent 不再持有任何 WebSocket 连接，全部交互走 HTTP(S) 伪装信道（AI 风格端点 + SSE 事件流）；WebSocket 仅保留给 Console 实时通道。

## 快速开始

环境：Rust 1.80+ · .NET SDK 10 · Node.js 20+ · MongoDB 7.0+。

```bash
# 1. Server（http://localhost:5270）
cd src/service && dotnet run
# 2. Console（http://localhost:5173，首次访问 /setup 建管理员）
cd src/webapp && npm install && npm run dev
# 3. 载荷：Console 的 Builder 页在线构建 Win/Linux 载荷（交叉构建需 zig 工具链）
```

三条插件入口：**上传插件**（zip）/ **从 Git 导入**（[插件开发脚手架](https://github.com/SmaZone2020/Libra-Plugin-Template)）/ **插件市场**（[Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) 官方仓库一键安装，浏览器直连 GitHub raw + 1h 缓存，支持手动刷新）。

## 核心功能

- **通信**：HTTP(S) 伪装信道（OpenAI 风格端点 + SSE 任务事件流），AES-256-GCM 全链路加密，RSA 动态密钥协商；Console 实时通道走 WebSocket（30s 保活）
- **流量伪装**：可配置 Profile（通信路径/请求头/UA 等），Builder 中持久化管理、启用/禁用；连接参数（协议/心跳/抖动）构建时注入
- **Agent**：多任务并行处理（模块锁外执行）、交互式 Shell（xterm.js）、间接 Syscall 与睡眠混淆、反沙盒/反虚拟机、内存态 PowerShell（CLR Host）、多维度持久化
- **侦查**：系统/硬件指纹、网络与 GeoIP、WiFi/LAN/蓝牙扫描、进程/窗口/账户
- **凭据**：浏览器密码、RDP 凭证、SSH 密钥、微信数据、AI 工具 API Key（插件）
- **代理**：Socks 代理模块 + ProxyBrowser 内网 Web 浏览
- **插件体系**：上传 zip / Git 导入 / 插件市场（GitHub raw 直连 + 1h 浏览器缓存 + 手动刷新按钮）
- **Builder**：在线构建 Win/Linux 载荷、模块启用开关、一键投递（PowerShell/Cmd/Bash 命令、LNK 打包、匿名下载链接）
- **MCP**：内置 MCP 服务器（Streamable HTTP，`/mcp`，可开关），AI 客户端可直接调用全部 C2 功能
- **Console**：ECharts 仪表盘（流量图/地图）、后端地址可配置 + 断线重连、审计日志、风险策略

## 平台支持

| 平台 | 状态 |
| --- | --- |
| Windows x64 | ✅ 主平台，全功能验证 |
| Linux x64 | ⚠️ 交叉编译通过，运行时待实测 |
| Windows x86 | ❌ 不支持（间接 Syscall 无 32 位实现，Builder 已禁用） |

详见 [平台支持矩阵](docs/平台支持矩阵.md)（实测记录）。

## 质量保障

- **CI**（GitHub Actions，`.github/workflows/ci.yml`）：Rust（fmt + workspace 测试）、.NET（构建 + format 校验 + MongoDB 集成测试）、WebApp（typecheck + Vitest + 构建）
- **测试**：Rust 单元/集成测试、`src/tests/LibraNextgen.Tests` 服务端集成测试、`src/webapp` Vitest 组件测试
- **回归**：`scripts/e2e/` 自动化回归套件（Agent 协议/模块管理/流量伪装/下载格式等 14 项场景），`run-all.ps1` 一键执行

## 文档

| 主题 | 内容 |
| --- | --- |
| [插件开发教程](docs/zh/插件开发.md) | meta.json 契约、zip 结构、JS/native 双通道、前端 `usePluginHost`、示例插件 |
| [部署与构建](docs/zh/部署与构建.md) | Server/Console 部署、Builder 在线构建、Win/Linux 交叉编译、插件模块 stage |
| [部署手册](docs/部署手册.md) | 生产部署：环境变量（`LIBRA_SERVER_KEY`/`LIBRA_BUILDS_DIR`）、MongoDB 认证、nginx/TLS |
| [平台支持矩阵](docs/平台支持矩阵.md) | 各平台实测记录（构建命令/结果/结论） |
| [操作手册](docs/zh/操作手册.md) | Agent 上线、插件市场/上传/Git 导入、Shell/文件/MCP 使用、审计与风险策略 |
| [LLM 插件开发指南](docs/LLM-插件开发指南.md) | 面向 LLM 的插件开发指引（契约/通道/打包） |

## 相关仓库

| 仓库 | 说明 |
| --- | --- |
| [Libra-Plugin-Template](https://github.com/SmaZone2020/Libra-Plugin-Template) | 插件开发脚手架：`meta.json` 契约 + `module/`（Agent 端脚本）+ `service/`（服务端 C#）+ `page/`（前端页面），`npm run pack` 一键打包 |
| [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) | 官方插件仓库：按 `plugins/<pluginId>/` 存放打包 zip，`index.json` 由 CI 自动重建，作为 Console「插件市场」的安装源 |

## 许可证

GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>

## 免责声明

本软件**仅限**在授权场景中使用（自有资产安全评估、签署交战规则的红队行动、隔离实验环境、企业授权漏洞验证）。**未经系统所有者明确书面授权，严禁**对任何系统、网络或数据进行未授权访问。使用者必须遵守所有适用的法律法规。
