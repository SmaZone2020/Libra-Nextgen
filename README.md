# Libra-Nextgen

面向企业级红蓝对抗的现代化 **C2（Command & Control）框架**

![.NET](https://img.shields.io/badge/.NET-C172D7?style=flat-square&logo=.net&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-FFFFFF?style=flat-square&logo=rust&logoColor=black)
![MongoDB](https://img.shields.io/badge/MongoDB-21BF3E?style=flat-square&logo=mongodb&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)
![HeroUI](https://img.shields.io/badge/HeroUI-000000?style=flat-square&logo=heroui&logoColor=white)

## 架构

| 组件 | 目录 | 技术栈 |
| --- | --- | --- |
| **Agent** | `src/agent-rs/` | Rust · Tokio · Win32 FFI · 多任务并发 |
| **Server** | `src/service/` | ASP.NET Core 10 · MongoDB · JWT |
| **Console** | `src/webapp/` | React 19 · HeroUI 3 · Vite |

Agent 采用 **Bootstrapper + 云载模块**：内核只保留通信/加密/调度/流式，文件、凭据、侦查、Shell 等能力作为模块按需从 Server 下载、内存加载、零落盘；并用 **插件体系**（zip 包交付）覆盖自定义能力——Agent 端 Rhai 脚本（免编译）/ native `cdylib` 双通道，前端运行时注册页面。

## 快速开始

环境：Rust 1.80+ · .NET SDK 10 · Node.js 20+ · MongoDB 7.0+。

```bash
# 1. Server（http://localhost:5270）
cd src/service && dotnet run
# 2. Console（http://localhost:5173，首次访问 /setup 建管理员）
cd src/webapp && npm install && npm run dev
# 3. 载荷：Console 的 Builder 页在线构建 Win/Linux 载荷（交叉构建需 zig 工具链）
```

三条路：**上传插件**（zip）/ **从 Git 导入**（[插件开发脚手架](https://github.com/SmaZone2020/Libra-Plugin-Template) 链接）/ **插件市场**（[Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) 官方仓库一键安装，走 GitHub raw 直连 + 1h 浏览器缓存）。

## 核心功能

- **通信**：HTTP(S) 轮询 + WebSocket 双模，AES-256-GCM 全链路加密，RSA 动态密钥协商
- **Agent**：多任务并行处理（模块锁外执行）、交互式 Shell（xterm.js/PTY）、屏幕/摄像头/麦克风流式监控、反沙盒/反虚拟机、多维度持久化
- **侦查**：系统/硬件指纹、网络与 GeoIP、WiFi/LAN/蓝牙扫描、进程/窗口/账户
- **凭据**：浏览器密码、RDP 凭证、SSH 密钥、微信数据、AI 工具 API Key（插件）
- **插件市场**：独立仓库存东 zip + `index.json`（CI 自动重建），Console 一键安装/更新
- **MCP**：内置 MCP 服务器（Streamable HTTP），AI 客户端可直接调用全部 C2 功能

## 文档

| 主题 | 内容 |
| --- | --- |
| [插件开发教程](docs/zh/插件开发.md) | meta.json 契约、zip 结构、Rhai/native 双通道、前端 `usePluginHost`、示例插件 |
| [部署与构建](docs/zh/部署与构建.md) | Server/Console 部署、Builder 在线构建、Win/Linux 交叉编译、插件模块 stage |
| [操作手册](docs/zh/操作手册.md) | Agent 上线、插件市场/上传/Git 导入、Shell/文件/MCP 使用、审计与风险策略 |

## 相关仓库

| 仓库 | 说明 |
| --- | --- |
| [Libra-Plugin-Template](https://github.com/SmaZone2020/Libra-Plugin-Template) | 插件开发脚手架：`meta.json` 契约 + `module/`（Agent 端脚本）+ `service/`（服务端 C#）+ `page/`（前端页面），`npm run pack` 一键打包 |
| [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) | 官方插件仓库：按 `plugins/<pluginId>/` 存放打包 zip，`index.json` 由 CI 自动重建，作为 Console「插件市场」的安装源 |

## 许可证

GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>

## 免责声明

本软件**仅限**在授权场景中使用（自有资产安全评估、签署交战规则的红队行动、隔离实验环境、企业授权漏洞验证）。**未经系统所有者明确书面授权，严禁**对任何系统、网络或数据进行未授权访问。使用者必须遵守所有适用的法律法规。
