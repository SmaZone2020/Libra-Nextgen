<div align="center">
  <img src="/assets/branding/hero.png" width="600"/>
  <h1>Libra-Nextgen</h1>

  面向企业红蓝对抗的开源 C2（Command & Control）框架

  ![.NET](https://img.shields.io/badge/.NET-C172D7?style=flat-square&logo=.net&logoColor=black)
  ![Rust](https://img.shields.io/badge/Rust-FFFFFF?style=flat-square&logo=rust&logoColor=black)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
  ![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)
  ![HeroUI](https://img.shields.io/badge/HeroUI-000000?style=flat-square&logo=heroui&logoColor=white)
  ![MongoDB](https://img.shields.io/badge/MongoDB-21BF3E?style=flat-square&logo=mongodb&logoColor=white)

  ![Release](https://img.shields.io/github/v/release/SmaZone2020/Libra-Nextgen?style=flat-square)
  ![CI](https://github.com/SmaZone2020/Libra-Nextgen/actions/workflows/ci.yml/badge.svg)

  <p><b>简体中文</b> | <a href="README_en.md">English</a></p>

</div>

Libra-Nextgen 是一个开源的跨平台对抗模拟 / 红队框架，面向企业安全测试场景。它由三部分组成：Rust 编写的轻量 Agent、ASP.NET Core 服务端与 React Web 控制台。Agent 采用 Bootstrapper + 云载模块架构——最小内核只负责通信与调度，其余能力按需从服务端下载并在内存中执行，不落盘。

Agent 通过 beacon HTTP(S) 与 SSE 事件流与服务器通信，全链路 AES-256-GCM 加密。插件体系以 zip 包交付自定义能力：Agent 端 JavaScript（QuickJS 沙箱）或 native 模块、服务端脚本、前端页面。

## 特性

- HTTP(S) beacon + SSE 事件流，AES-256-GCM 全链路加密，RSA 动态密钥协商
- 可配置流量伪装 Profile（路径 / 请求头 / UA）
- 内存加载、不落盘（Bootstrapper + 云载模块）
- 多任务并行，交互式 Shell
- 间接 Syscall 与睡眠混淆
- 反沙盒 / 反虚拟机
- 系统、硬件与网络指纹侦查（GeoIP）
- 凭据收集（RDP、SSH 密钥等）
- Socks 代理与内网 Web 浏览
- 内存态 PowerShell（CLR Host）
- 多维度持久化
- 插件体系：上传 zip / Git 导入 / 插件市场，页面为纯 HTML+JS+CSS
- 在线载荷构建（Builder），Windows / Linux
- Docker 一键部署（单端口 443，容器内交叉构建 win/linux Agent）
- 内置 AI 助手 Justitia（分级权限 + 工具调用审计）
- AI 频道：Telegram / 飞书 / 微信 iLink 在 IM 中指挥 Justitia，支持绑定码、内联审批、菜单与群组调用
- 内置 MCP 服务器（Streamable HTTP）
- 多人协同控制台（实时同步、审计日志）

## 快速开始

### Docker 一键部署（推荐，linux/amd64）

内网 HTTP 与公网 HTTPS（TLS）均可部署，控制台与 Agent 走同一入口；见[部署手册 §6.2](docs/deployment.md)。

```bash
cd deploy
cp .env.example .env   # 填写 VITE_API_BASE（控制台公共访问源，如 https://c2.example.com）
docker compose up -d --build
```

浏览器打开 `VITE_API_BASE` 对应地址，首次访问 `/setup` 创建管理员。详见[部署手册 §6.2](docs/deployment.md)。

### 本地开发启动

需要 MongoDB 7.0+、.NET SDK 10、Node.js 20+（构建 Agent 载荷另需 Rust 1.80+）。

```bash
# 启动 Server（端口 5270）
cd src/LibraNextgen.Server
dotnet run

# 启动 Console（端口 5173）
cd src/console
npm install
npm run dev
```

浏览器打开 <http://localhost:5173>，首次访问创建管理员账户。Agent 载荷可在 Console 的 Builder 页在线构建。完整部署细节（nginx/TLS/密钥/升级/迁移）见[部署手册](docs/deployment.md)。

## 平台支持

| 平台 | 状态 |
| --- | --- |
| Windows x64 | 支持（主平台，全功能验证） |
| Linux x64 | 交叉编译通过 |

详见 [平台支持矩阵](docs/platform-support.md)。

## 文档

- [文档索引](docs/README.md) — 全部文档导航(中/英)
- [插件开发教程](docs/zh/plugin-development.md) — meta.json 契约、Agent 双通道、HTML 页面
- [HTML 插件页面 SDK](docs/plugins/html-plugin-sdk.md) — 注入式 `window.Libra` 契约
- [部署手册](docs/deployment.md) — MongoDB 认证、nginx/TLS、Builder 与云载模块
- [操作手册](docs/zh/operations.md) — Agent 上线、插件安装、Shell / 文件 / MCP、审计与风险策略
- [AI 频道(IM 接入)](docs/zh/ai-channels.md) — Telegram / 微信 iLink / 飞书
- [平台支持矩阵](docs/platform-support.md)

## 相关仓库

- [Libra-Plugin-Template](https://github.com/SmaZone2020/Libra-Plugin-Template) — 插件开发脚手架
- [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) — 官方插件仓库（插件市场安装源）

## 许可证

GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>

## 免责声明

本软件仅限授权场景使用（自有资产评估、签署交战规则的红队行动、隔离实验环境）。未经系统所有者明确书面授权，严禁对任何系统、网络或数据进行未授权访问。
