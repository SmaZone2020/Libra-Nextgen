<div align="center">
  <img src="/assets/hero.png" width="600"/>
  <h1>Libra-Nextgen</h1>

  面向企业级红蓝对抗的现代化 **C2（Command & Control）框架**
  
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

## 架构

| 组件 | 目录 | 技术栈 |
| --- | --- | --- |
| **Agent** | `src/agent-rs/` | Rust · Tokio · Win32 FFI · 多任务并发 |
| **Server** | `src/service/` | ASP.NET Core 10 · MongoDB · JWT |
| **Console** | `src/webapp/` | React 19 · HeroUI 3 · Vite |

Agent 采用 **Bootstrapper + 云载模块**：loader 反射加载加密最小内核 `core.bin`（通信/加密/调度/流式），文件、凭据、侦查、Shell、PowerShell、代理、Token 等能力全部作为**模块**按需从 Server 下载，**内存加载执行，不落盘**。**插件体系**（zip 包交付）覆盖自定义能力——Agent 端 **JavaScript（QuickJS 沙箱，免编译）** / native `cdylib` 双通道，服务端 C# 脚本，前端运行时注册页面。

## 快速开始

### 1. 安装环境

| 依赖 | 版本 | 安装 | 说明 |
| --- | --- | --- | --- |
| **MongoDB** | 7.0+ | 官网下载安装包 / `winget install MongoDB.Server` / Docker | 数据存储，**必须先启动**。本机默认连接串 `mongodb://localhost:27017`，启动后可用 `mongod --dbpath <数据目录>` 运行；Docker：`docker run -d -p 27017:27017 --name libra-mongo mongo:7` |
| **.NET SDK** | 10.0（LTS） | <https://dotnet.microsoft.com/download>（Linux 用 dotnet-install 脚本） | 运行 Server（`src/service`），`dotnet --version` 应输出 10.x |
| **Node.js** | 20+（含 npm） | <https://nodejs.org>（推荐 LTS） | 运行 Console（`src/webapp`） |
| **Rust**（可选） | 1.80+ | <https://rustup.rs> | 仅在用 Builder 页**在线构建 Agent 载荷**时需要；Windows 需 MSVC 工具链（VS Build Tools），Linux 交叉构建需 `cargo-zigbuild` |

> Windows 安装后请**重新打开终端**再执行下面的命令，确保 PATH 生效；安装完成后分别用 `mongod --version` / `dotnet --version` / `node --version` / `cargo --version` 验证。

### 2. 启动 Server（后端 API，端口 5270）

```bash
cd src/service
dotnet run
```

- 首次启动自动连接 MongoDB 并建库建索引；库名 `libra_nextgen`，可参考 [部署手册](docs/部署手册.md) 的 `MongoDB__*` 环境变量覆盖连接串
- 监听地址/端口可在「设置 → 安全」里修改（默认 `0.0.0.0:5270`，仅本机回环调试可开启 loopback）

### 3. 启动 Console（前端，端口 5173）

```bash
cd src/webapp
npm install   # 首次或依赖变更后执行
npm run dev
```

浏览器打开 <http://localhost:5173>，首次访问会进入 `/setup` 创建管理员账户，登录后即可使用。

> 前端默认按页面地址自动推导后端地址（`localhost:5173` → `localhost:5270`），无需额外配置；仅当后端与前端不在同一主机时才需在 `src/webapp/.env` 设置 `VITE_API_BASE`（见 [部署手册](docs/部署手册.md)）。

### 4. 生成并运行 Agent 载荷（可选，需要 Rust）

Console 的 **Builder** 页在线构建 Windows/Linux 载荷（交叉构建需 zig 工具链），在目标机器运行产物即自动上线。内置 Agent 端模块（shell/recon/creds/files 等）按需从 Server 下载、内存加载。

插件安装途径：**上传**（zip 包）/ **从 Git 导入**（[插件开发脚手架](https://github.com/SmaZone2020/Libra-Plugin-Template)）/ **插件市场**（[Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) 官方仓库在线安装）。

## 核心功能

- **通信**：HTTP(S) 伪装信道（OpenAI 风格端点 + SSE 任务事件流），AES-256-GCM 全链路加密，RSA 动态密钥协商；Console 实时通道基于 WebSocket（30 秒保活）
- **流量伪装**：可配置 Profile（通信路径/请求头/UA 等），Builder 中持久化管理、启用/禁用；连接参数（协议/心跳/抖动）构建时注入
- **Agent**：多任务并行处理（模块锁外执行）、交互式 Shell（xterm.js）、间接 Syscall 与睡眠混淆、反沙盒/反虚拟机、内存态 PowerShell（CLR Host）、多维度持久化
- **侦查**：系统/硬件指纹、网络与 GeoIP、WiFi/LAN/蓝牙扫描、进程/窗口/账户
- **凭据**：浏览器密码、RDP 凭证、SSH 密钥
- **代理**：Socks 代理模块 + ProxyBrowser 内网 Web 浏览
- **插件体系**：上传 zip / Git 导入 / 插件市场在线安装与更新
- **Builder**：在线构建 Win/Linux 载荷、模块启用开关、投递（PowerShell/Cmd/Bash 命令、LNK 打包、匿名下载链接）
- **AI 助手 Justitia**：流式对话与工具调用、Justitia 四档权限体系（COGNITIO/ARBITRIUM/IMPERIUM/DICTATURA，服务端强制校验）、超档工具审批模态框（一次性 / 5min / 20min 临时许可）、`request_tier_elevation` 提权通道、工具调用审计（档位→风险等级映射）
- **MCP**：内置 MCP 服务器（Streamable HTTP，`/mcp`，可开关）——Console 内置 AI 助手 Justitia 可直接调用 C2 工具，另支持独立 AI 客户端接入
- **Console**：ECharts 仪表盘（流量图/地图）、后端地址可配置、断线重连、审计日志、风险策略、内置 AI 助手 Justitia

## 平台支持

| 平台 | 状态 |
| --- | --- |
| Windows x64 | 支持（主平台，全功能验证） |
| Linux x64 | 交叉编译通过，运行时待验证 |
| Windows x86 | 不支持（无 32 位间接 Syscall 实现，Builder 已禁用） |

详见 [平台支持矩阵](docs/平台支持矩阵.md)。

## 文档

| 主题 | 内容 |
| --- | --- |
| [插件开发教程](docs/zh/插件开发.md) | meta.json 契约、zip 结构、JS/native 双通道、前端 `usePluginHost`、示例插件 |
| [部署手册](docs/部署手册.md) | MongoDB 认证、nginx/TLS、Builder 构建、云载模块与插件 stage |
| [平台支持矩阵](docs/平台支持矩阵.md) | 各平台实测记录（构建命令/结果/结论） |
| [操作手册](docs/zh/操作手册.md) | Agent 上线、插件市场/上传/Git 导入、Shell/文件/MCP 使用、审计与风险策略 |
| [LLM 插件开发指南](docs/LLM-插件开发指南.md) | 面向 LLM 的插件开发指引 |

## 相关仓库

| 仓库 | 说明 |
| --- | --- |
| [Libra-Plugin-Template](https://github.com/SmaZone2020/Libra-Plugin-Template) | 插件开发脚手架：`meta.json` 契约 + `module/`（Agent 端脚本）+ `service/`（服务端 C#）+ `page/`（前端页面），`npm run pack` 打包 |
| [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) | 官方插件仓库：按 `plugins/<pluginId>/` 存放打包 zip，`index.json` 由 CI 自动重建，作为 Console「插件市场」的安装源 |

## 许可证

GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>

## 免责声明

本软件**仅限**在授权场景中使用（自有资产安全评估、签署交战规则的红队行动、隔离实验环境、企业授权漏洞验证）。**未经系统所有者明确书面授权，严禁**对任何系统、网络或数据进行未授权访问。使用者必须遵守所有适用的法律法规。
