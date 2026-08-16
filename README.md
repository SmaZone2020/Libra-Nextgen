# Libra-Nextgen

面向企业级红蓝对抗的现代化 C2（Command & Control）框架。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Libra-Console (React 19)                     │
│              操作控制台 · 多人协同 · 实时流媒体                    │
│                   http://localhost:5173                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ WebSocket / REST
┌──────────────────────────▼──────────────────────────────────────┐
│               Libra-Server (ASP.NET Core 10)                    │
│          流量接入 · 任务调度 · MongoDB 持久化 · JWT 鉴权           │
│                   http://localhost:5270                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP(S) / WebSocket (AES-256-GCM)
┌──────────────────────────▼──────────────────────────────────────┐
│                  Libra-Agent (Rust)                             │
│       跨平台载荷 · 模块化侦查 · 内存执行 · 反沙盒 · 持久化          │
└─────────────────────────────────────────────────────────────────┘
```

### 子系统

| 组件          | 目录              | 技术栈                                                        |
| ----------- | --------------- | ---------------------------------------------------------- |
| **Agent**   | `src/agent-rs/` | Rust 2021 · Tokio · Win32/WinRT FFI · `windows` crate      |
| **Server**  | `src/service/`  | ASP.NET Core 10 · MongoDB · JWT (RSA) · WebSocket          |
| **Console** | `src/webapp/`   | React 19 · TypeScript · HeroUI 3 · Vite 6 · Tailwind CSS 4 |

### Agent 工作区 (`src/agent-rs/`)

6 个 crate 组成的 Rust workspace：

| Crate            | 用途                                             |
| ---------------- | ---------------------------------------------- |
| `agent`          | 独立可执行文件：配置解析、持久化管理、反沙盒检查、主引擎                   |
| `libra-common`   | 共享模型（`InjectedConfig`、`AgentTask`）、协议常量        |
| `libra-crypto`   | RSA-2048 + AES-256-GCM 协商加密                    |
| `libra-comm`     | HTTP 轮询 + WebSocket 长连接双模通信                    |
| `libra-platform` | 硬件信息采集（CPU/GPU/RAM/磁盘/显示器）、WMI 查询、`sysinfo` 回退 |
| `libra-modules`  | 全部作战模块（见下方功能矩阵）                                |

### Server 项目 (`src/service/`)

ASP.NET Core WebAPI，包含：

- `Controllers/` — 17 个 REST 控制器（Agents、Tasks、Builder、Files、System、Media、Screen、Proxy、Audit 等）
- `Services/` — 12 个业务服务（AgentService、TaskService、AuthService、HeartbeatMonitor 等）
- `Hubs/` — WebSocket 连接管理（原生 WebSocket，非 SignalR）
- `Middleware/` — 审计日志中间件
- `Profiles/` — 可塑 C2 配置文件（流量伪装）
- `Data/` — MongoDB 上下文与通用仓库

### Console 页面 (`src/webapp/src/pages/`)

15 个页面模块：

| 页面            | 路由             | 功能                                              |
| ------------- | -------------- | ----------------------------------------------- |
| Dashboard     | `/`            | 统计卡片、流量图、代理地理分布地图                               |
| Agents        | `/agents`      | 代理列表、详情面板（硬件信息折叠面板）、凭据导出                        |
| Shell         | `/shell`       | 基于 xterm.js 的远程交互式终端                            |
| ScreenMonitor | `/screen`      | 屏幕差异流媒体（64x64 块差分 + 关键帧）                        |
| MediaMonitor  | `/media`       | 摄像头 / 麦克风实时流                                    |
| FileManager   | `/files`       | 远程文件浏览（分页懒加载）、打开/执行、压缩包浏览、上传、下载、压缩 |
| System        | `/system`      | 进程列表、窗口枚举、环境变量、网络信息、WiFi 扫描、LAN 扫描              |
| SoftwareData  | `/othersoft`   | 微信/QQ 数据、浏览器凭据（Chrome/Edge v10+v20）、AI Token 扫描 |
| ProxyBrowser  | `/proxy`       | 通过受控代理访问网页                                      |
| Builder       | `/builder`     | 代理载荷编译生成                                        |
| AuditLogs     | `/audit`       | 操作审计日志查询                                        |
| Settings      | `/settings`    | MCP AccessKey 管理                                 |

## Agent 功能矩阵

### 侦查（Recon）

- **系统指纹**：OS 版本、架构、CPU、GPU、RAM、磁盘序列号、主板/BIOS 版本
- **网络情报**：公网 IP、GeoIP（城市/ISP/ASN/坐标）、代理设置、DNS 后缀
- **WiFi 扫描**：Win32 Wlan API（主）+ `netsh wlan show networks mode=bssid` 正则解析（回退）。输出 SSID、BSSID、认证方式、加密算法、信号强度、频段（2.4GHz / 5GHz / 6GHz）
- **LAN 扫描**：ARP 表查询 + ICMP ping 探测
- **蓝牙扫描**：WinRT `BluetoothDevice.GetDeviceSelector` + `FindAllAsync`，支持 BLE 设备
- **进程枚举**：CreateToolhelp32Snapshot + WMI 回退
- **窗口枚举**：EnumWindows + 窗口标题采集
- **本地账户**：WMI `Win32_UserAccount` 查询，SID 管理员组检测
- **环境变量**：系统/用户 PATH 读取与编辑
- **浏览器凭据**：Chrome/Edge v10（DPAPI）和 v20（app-bound key，通过 LSASS 令牌模拟 → SYSTEM DPAPI → ChaCha20-Poly1305 解密）
- **AI Token 扫描**：常见 AI 供应商的 API 密钥文件扫描
- **第三方软件**：微信（WeChat）wxid 与文件目录、QQ 账户数据

### 执行（Execution）

- **Shell**：CMD / PowerShell（Windows），Bash / Zsh（Linux）
- **文件操作**：大文件分块上传/下载、移动、复制、删除、时间戳伪造；目录分页懒加载（200 条/页无限滚动）、压缩包在线浏览（ZIP store 模式零解压）、文件打开/执行
- **屏幕捕获**：多显示器支持，64x64 块差异流媒体 + JPEG 关键帧，通过 DXGI Desktop Duplication API 实现
- **摄像头**：WinRT `MediaCapture` + DirectShow 底层读取
- **麦克风**：WinRT `MediaCapture` + WaveIn API
- **凭据导出**：内存凭据 dump
- **代理浏览器**：通过受控代理访问任意 URL

### 反分析（Anti-Analysis）

- CPU 核心数 · 内存大小 · 磁盘容量基线检查
- 沙盒诱饵用户名/主机名检测
- 虚拟机特征检测（VMware/VirtualBox/Hyper-V）

### 持久化（Persistence）

- **Windows**：注册表 Run 键 · 计划任务（`schtasks /create /rl highest`）· ShellExecuteW + `runas` UAC 提权
- **Linux**：Crontab @reboot · systemd 服务

## 快速启动

### 环境要求

- **Rust** 1.80+（MSVC toolchain，Windows）
- **.NET SDK** 10.0+
- **Node.js** 20+
- **MongoDB** 7.0+（默认 `mongodb://localhost:27017`）

### 1. 启动 Server

```bash
cd src/service
dotnet run
# 监听 http://localhost:5270
# API 文档: http://localhost:5270/scalar/v1
```

首次启动会自动创建 MongoDB 数据库 `libra_nextgen` 及初始管理员账户。

### 2. 启动 Console

```bash
cd src/webapp
npm install
npm run dev
# 监听 http://localhost:5173
```

浏览器打开后访问设置页面 `/setup` 创建管理员账户，然后登录。

### 3. 构建 Agent

```bash
cd src/agent-rs
cargo build --release
# 输出: target/release/agent.exe
```

也可通过 Console 的 Builder 页面在线编译：配置 Server 地址、通信参数、持久化选项后一键生成。

### 4. 部署 Agent

将 `agent.exe` 部署至目标 Windows 主机并执行。Agent 启动后：

1. 若启用 `requireAdmin`，通过 UAC 提权
2. 若启用 `copyToPath`，复制自身到指定路径后重新启动
3. 若启用 `enablePersistence`，安装计划任务/Cron
4. 执行反沙盒检查
5. 与 Server 建立加密通信，注册上线

## 配置注入

Agent 支持在二进制文件末尾注入 JSON 配置：

```
[原始 PE 数据][CONFIG_MAGIC][4 字节 LE 长度][JSON 配置]
```

`InjectedConfig` 模型定义于 `libra-common/src/models.rs`：

```json
{
  "serverUrl": "http://192.168.1.100:5270",
  "registerPath": "/api/agentcomms/register",
  "heartbeatPath": "/api/agentcomms/heartbeat",
  "resultPath":  "/api/agentcomms/result",
  "heartbeatIntervalSecs": 5,
  "enablePersistence": true,
  "requireAdmin": true,
  "copyToPath": "Microsoft\\SecurityHealth"
}
```

## MCP 服务器

Libra-Nextgen 内置 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 服务器，允许 AI 客户端（如 Claude Desktop、Cursor、Windsurf 等）通过标准 MCP 协议直接调用全部 C2 功能。

### 端点

```
http://localhost:5270/mcp
```

支持 Streamable HTTP 和 SSE 两种传输方式。

### 鉴权

MCP 服务器使用 AccessKey 鉴权。在请求 Header 中携带：

```
Authorization: Bearer lnk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 创建 AccessKey

1. **通过 Web Console**：登录后进入「设置」页面，点击「创建密钥」，设置名称和（可选的）过期时间。创建成功后立即复制密钥（仅显示一次）。

2. **通过 API**：

```bash
curl -X POST http://localhost:5270/api/access-keys \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-ai-client", "expiresAt": "2025-12-31T00:00:00Z"}'
```

### 配置 AI 客户端

#### Claude Desktop

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "libra-nextgen": {
      "url": "http://localhost:5270/mcp",
      "headers": {
        "Authorization": "Bearer lnk_your_access_key_here"
      }
    }
  }
}
```

#### Cursor / Windsurf

在 MCP 配置中添加 HTTP 类型的 MCP 服务器，URL 填写 `http://localhost:5270/mcp`，Header 中设置 `Authorization: Bearer lnk_xxx`。

### 可用工具

MCP 服务器提供以下工具集：

| 工具类别 | 工具 | 说明 |
|---------|------|------|
| **Agent** | `list_agents`, `get_agent`, `delete_agent` | 管理在线代理 |
| **Task** | `list_tasks`, `get_task`, `create_task`, `cancel_task` | 任务调度与管理 |
| **Shell** | `execute_shell`, `execute_powershell` | 远程命令执行 |
| **File** | `list_directory`, `get_drives`, `download_file`, `upload_file`, `delete_file`, `rename_file`, `move_file`, `copy_file` | 文件系统操作 |
| **System** | `get_processes`, `kill_process`, `get_network_info`, `scan_wifi`, `scan_lan` | 系统信息与网络扫描 |
| **Screen** | `take_screenshot`, `capture_webcam` | 屏幕截图与摄像头 |
| **Data** | `get_browser_passwords`, `get_browser_history`, `scan_ai_tokens` | 数据窃取 |
| **Builder** | `build_payload`, `list_builds`, `get_build_info` | 载荷编译 |

### 使用示例

连接成功后，可直接用自然语言与 AI 交互：

- "列出所有在线的 Agent"
- "在 Agent xxx 上执行 whoami"
- "截取 Agent xxx 的屏幕截图"
- "扫描 Agent xxx 所在网络的 WiFi 热点"
- "构建一个连接到 192.168.1.100:5270 的 Agent 载荷"

## 许可证

Libra-Nextgen 基于 **GNU General Public License v3.0（GPL-3.0）** 发布。

本程序为自由软件：你可以基于自由软件基金会发布的 GNU 通用公共许可证条款对其进行再发布和/或修改；可以选择使用许可证的第 3 版，或（由你选择）任何更新版本。

本程序的发布是希望它能够对授权的安全研究和企业红队行动有用，但**不提供任何担保**；甚至不保证适销性或适用性的隐含担保。详情请参阅 GNU 通用公共许可证。

完整许可证文本：<https://www.gnu.org/licenses/gpl-3.0.html>

## 免责声明

Libra-Nextgen **仅限**在以下明确授权场景中使用：

- 对自有基础设施或系统的安全评估
- 已签署书面交战规则（RoE）的红队行动
- 隔离实验环境中的网络安全研究
- 企业环境内授权的漏洞验证

**未经系统所有者明确书面授权，严禁**对任何计算机系统、网络或数据进行未授权访问。使用者必须遵守所有适用的地方法律、国家法律和国际法规。
