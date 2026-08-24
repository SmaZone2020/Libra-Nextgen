# Libra-Nextgen

面向企业级红蓝对抗的现代化 C2（Command & Control）框架。

## 架构

| 组件 | 目录 | 技术栈 |
| --- | --- | --- |
| **Libra-Agent** | `src/agent-rs/` | Rust · Tokio · Win32 FFI |
| **Libra-Server** | `src/service/` | ASP.NET Core 10 · MongoDB · JWT |
| **Libra-Console** | `src/webapp/` | React 19 · HeroUI 3 · Vite |

Agent 采用 **Bootstrapper + 云载模块** 架构：loader 反射加载加密的最小内核（通信 / 加密 / 调度 / 流式功能），其余能力（文件、凭据、侦查、Shell、PowerShell、代理等）作为独立模块按需从 Server 下载并在内存中加载，磁盘零落地。同时提供**插件体系**：用户可通过 zip 包交付自定义插件，Agent 端支持 Rhai 脚本（免编译）与 native `cdylib` 双通道。

## 核心功能

- **通信**：HTTP(S) 轮询 + WebSocket 长连接双模，AES-256-GCM 全链路加密，RSA 动态密钥协商
- **插件体系**：三层贯通（Agent / Server / Console），Rhai 脚本免编译 + `#if/#elif/#else/#endif` 条件编译 + 平台 API 门控 + 沙箱；前端运行时注册 + `usePluginHost` 共享状态；插件管理页导入/启停
- **隐蔽性**：反沙盒 / 反虚拟机探针、PEB 伪装、UAC 提权、多维度持久化（注册表 / 计划任务 / Cron / systemd）
- **侦查**：系统 / 硬件指纹、网络与 GeoIP、WiFi / LAN / 蓝牙扫描、进程 / 窗口 / 本地账户
- **凭据**：浏览器密码（Chrome/Edge v10/v20）、RDP 凭证、SSH 密钥、QQ/微信数据、QQ clientkey（jump 兑换 skey/bkn）、AI 密钥扫描
- **执行**：交互式 Shell（xterm.js）、PowerShell 内存执行、屏幕 / 摄像头 / 麦克风流式监控
- **文件**：分页浏览、流式下载（实时进度与速度）、上传、压缩包在线浏览、时间戳伪造
- **MCP**：内置 MCP 服务器，AI 客户端可直接调用全部 C2 功能

## 快速开始

环境要求：Rust 1.80+、.NET SDK 10、Node.js 20+、MongoDB 7.0+。

### Windows 部署

```powershell
# 1. 启动 Server（http://localhost:5270）
cd src\service
dotnet run

# 2. 启动 Console（http://localhost:5173，首次访问 /setup 创建管理员）
cd src\webapp
npm install
npm run dev
```

通过 Console 的 **Builder** 页面在线构建载荷：

- **Win x64 / Win x86**：原生 MSVC 编译（需 VS Build Tools + Rust MSVC 工具链）
- **Linux x64**：交叉编译（服务端自动走 zig 工具链，需安装）：

```powershell
# 交叉构建 Linux 载荷所需工具
cargo install cargo-zigbuild
# 下载 zig（https://ziglang.org/download）并加入 PATH
```

### Linux 部署

```bash
# 1. 启动 Server（http://localhost:5270）
cd src/service
dotnet run

# 2. 启动 Console（http://localhost:5173，首次访问 /setup 创建管理员）
cd src/webapp
npm install
npm run dev
```

通过 Console 的 **Builder** 页面在线构建载荷：

- **Linux x64**：原生编译（rustc 默认工具链）
- **Win x64 / Win x86**：交叉编译（mingw ABI，同样经 zig 工具链）：

```bash
cargo install cargo-zigbuild   # 交叉构建 Windows 载荷所需工具
# 下载 zig（https://ziglang.org/download）并加入 PATH
```

> 说明：无论 Server 运行在 Windows 还是 Linux，均可构建 Windows 与 Linux 载荷；交叉构建由服务端自动探测 zig 工具链并调用 cargo-zigbuild，缺失时构建会给出明确提示。命令行本地构建（`cargo build --release`）仅产出本机平台的载荷。

## 插件开发

插件以 zip 包交付，在 Console 的**插件管理页**导入/启用即可。包结构：

```
plugin.zip
├── meta.json      # 插件契约：pluginId / entry(route, icon) / actions(argsSchema)
├── module/        # Agent 端模块（二选一）
│   ├── xxx.rhai   # 脚本通道（免编译，推荐）—— 支持 #if(WINDOWS)/#elif(LINUX)/#endif
│   └── xxx.dll    # native 通道（Rust/C/C++ 编译为 cdylib，导出 module_main/module_name）
└── page/          # 前端页面源码（HeroUI，放入前端 src/webapp/src/plugins/<pluginId>/ 重新构建）
```

- **Agent 端**：脚本通道由内置 Rhai 引擎执行，按平台开放不同 API（Windows `cmd/powershell/reg_*`、Linux `shell/bash/uname/ip_route`），`full` feature 可扩展深度 API；native 通道走 `libra-load` 内存加载
- **服务端**：`meta.json` 声明式契约 + 动作网关 `POST /api/plugins/{pluginId}/{action}`（自动校验 argsSchema → 下发 Agent → 回收结果）；不加载第三方代码进主进程
- **前端**：页面通过 `usePluginHost()` 拿到 `selectedAgent` / `dispatchTask` / `subscribeOutput`（复用控制台共享状态）；`import.meta.glob` 运行时注册路由与侧边栏
- **示例**：`examples/plugin-sdk/`（活文档 + 全功能多平台模块）、`examples/soft-recon/`（端到端）

## 已知问题

- **Shell 页面终端字符无法对齐**：终端使用等宽字体渲染，但中英文混排时，中文字符与拉丁字符的宽度比例无法在网页端精确对齐（xterm.js 将 CJK 视为双倍宽度，受系统字体与网页字体 fallback 影响），可能导致 `ls` 等对齐排版在混合内容下出现轻微错位。

## MCP

端点 `http://localhost:5270/mcp`（Streamable HTTP），使用 AccessKey 鉴权（`Authorization: Bearer lnk_xxx`），在 Console 设置页或 API 创建。可用工具清单见 `GET /api/mcp/info`。

## 许可证

GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>

## 免责声明

本软件**仅限**在授权场景中使用（自有资产安全评估、签署交战规则的红队行动、隔离实验环境、企业授权漏洞验证）。**未经系统所有者明确书面授权，严禁**对任何系统、网络或数据进行未授权访问。使用者必须遵守所有适用的法律法规。
