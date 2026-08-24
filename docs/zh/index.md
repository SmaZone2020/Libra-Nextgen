# Libra-Nextgen 概览

面向企业级红蓝对抗的现代化 **C2（Command & Control）框架**：Rust Agent + ASP.NET Core Server + React/HeroUI Console。

## 架构

| 组件 | 目录 | 技术栈 |
| --- | --- | --- |
| **Libra-Agent** | `src/agent-rs/` | Rust · Tokio · Win32 FFI · 多任务并发 |
| **Libra-Server** | `src/service/` | ASP.NET Core 10 · MongoDB · JWT |
| **Libra-Console** | `src/webapp/` | React 19 · HeroUI 3 · Vite |

Agent = **Bootstrapper + 云载模块**：内核只保留通信/加密/调度/流式，其余能力（文件、凭据、侦查、Shell、PowerShell、代理）作为模块按需从 Server 下载、内存加载、零落盘。插件体系（zip 包）覆盖自定义能力：Agent 端 Rhai 脚本（免编译）/ native `cdylib` 双通道，前端运行时注册页面。

## 通信模型

- **HTTP(S) 轮询**：注册 / 心跳 / 任务拉取 / 结果回传
- **WebSocket 长连接**：实时消息（Shell、流式监控、任务分发）
- **加密**：RSA 动态协商 AES-256-GCM 会话密钥，无会话密钥即拒绝发送（无明文 fallback）
- **模块下载**：Agent 按需从 Server 下载模块二进制（会话密钥加密），内存加载

## Agent 并发模型

每条 WS 消息独立任务并发处理：模块在锁外执行（`prepare` 加载 + 无锁 `execute_module`），长任务（采集、网络、插件 collect）不阻塞接收、心跳与其它任务。

## 快速开始

环境：Rust 1.80+ · .NET SDK 10 · Node.js 20+ · MongoDB 7.0+。

```bash
# 1. Server（http://localhost:5270）
cd src/service && dotnet run
# 2. Console（http://localhost:5173，首次访问 /setup 建管理员）
cd src/webapp && npm install && npm run dev
# 3. 用 Console 的 Builder 页构建 Win/Linux 载荷（交叉构建需 zig 工具链）
```

三条插件入口：**上传插件**（zip）/ **从 Git 导入**（Git 链接）/ **插件市场**（Libra-Plugins 仓库一键安装）。

## 更多文档

- [插件开发教程](插件开发.md) — meta.json 契约、zip 结构、Rhai/native 双通道、前端接入、示例插件
- [部署与构建](部署与构建.md) — Server/Console 部署、Builder 在线构建、交叉编译、插件模块 stage
- [操作手册](操作手册.md) — Agent 上线、插件安装、Shell/文件/MCP、审计与风险策略

## 许可证

GNU General Public License v3.0。仅限授权场景使用，未经书面授权严禁未授权访问。