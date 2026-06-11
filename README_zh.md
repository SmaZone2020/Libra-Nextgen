# Libra-Nextgen

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**Libra-Nextgen** 是一款面向企业级红蓝对抗、授权渗透测试与网络安全研究的现代 C2（Command and Control）框架。它提供了全谱系后渗透工具集，基于高性能、低可观测性的三层架构设计：被控端（Agent）、服务端（Server）与基于 Web 的多人协同控制台（Console）。

> **项目地址:** https://github.com/SmaZone2020/Libra-Nextgen

---

## 概述

Libra-Nextgen 采用经典的三层分离架构，确保高可用性与并发操作能力：

- **Libra-Agent（被控端）** — 轻量级、跨平台、驻留内存的载荷，支持模块化插件按需加载。
- **Libra-Server（服务端）** — ASP.NET Core WebAPI + WebSocket 中枢，负责 Agent 通信调度、任务分发与数据持久化。
- **Libra-Console（控制端）** — 基于 React 的多操作员 Web 控制台，支持实时协同、交互式终端与丰富的数据可视化。

Agent 与 Server 之间的所有通信均采用 AES-256-GCM 加密（密钥通过 RSA 非对称协商），Server 端对 Console 操作员采用 JWT + RBAC 鉴权。

---

## 系统架构

```
┌──────────────────┐       WebSocket / REST        ┌──────────────────┐
│  Libra-Console   │ ◄──────────────────────────►  │  Libra-Server    │
│  (React Web UI)  │     JWT 鉴权, RBAC 权限       │  (ASP.NET Core)  │
│                  │     WebSocket 实时状态同步     │                  │
│  多人协同操作    │                                │  MongoDB         │
│  实时数据可视化  │                                │  操作审计日志    │
└──────────────────┘                                └────────┬─────────┘
                                                             │
                                                AES-256-GCM  │  WebSocket
                                                + RSA 密钥协商│  / HTTP(S)
                                                             │
                                                  ┌──────────┴──────────┐
                                                  │  Libra-Agent         │
                                                  │  (.NET Native AOT)   │
                                                  │                      │
                                                  │  内存加载模块        │
                                                  │  无磁盘写入          │
                                                  └─────────────────────┘
```

---

## 功能矩阵

### Agent — 被控端

| 类别 | 能力 |
|---|---|
| **通信方式** | HTTP(S) 轮询 + WebSocket 长连接；Malleable C2 流量变形；User-Agent 轮换；代理感知 |
| **跨平台** | Windows + Linux；Native AOT 编译；统一 `IExecutor` 抽象层（Win32 P/Invoke / Linux syscall） |
| **主机侦察** | 系统指纹、域环境探测（LDAP/RPC）、Wi-Fi 热点扫描、硬件与电池状态枚举、GeoIP 定位 |
| **反分析** | 反虚拟机/反沙盒检测；CPU/内存/磁盘延时校验；鼠标轨迹启发式判断；高危环境自动休眠/自毁 |
| **命令执行** | Linux 伪终端（PTY）+ Windows PowerShell Runspace 内存执行；.NET 程序集内存反射加载，全程无磁盘写入 |
| **凭据收集** | LSASS 内存凭据提取；SAM 数据库读取；浏览器密码导出；Token 窃取与身份模拟 |
| **持久化** | 注册表 Run 键；计划任务（Windows）；Crontab / systemd 服务（Linux）；WMI 事件订阅 |
| **内网穿透** | SOCKS4/5 代理；端口转发（RDP、SSH 等） |
| **文件操作** | 分块上传/下载 + 断点续传；时间戳伪造（Timestomping）；NTFS ADS 流读取 |
| **物理监控** | 屏幕差分截图；摄像头静默抓拍（DirectShow/Media Foundation） |

### Server — 服务端

- ASP.NET Core 10 WebAPI + Kestrel 高性能服务器
- 原生 WebSocket 消息路由（Agent ↔ Console 双向中继）
- JWT (RS256) 鉴权 + RBAC 角色模型（`Admin` / `Operator`）
- MongoDB 文档数据库存储 Agent 元数据、任务结果与审计日志
- 支持多 Listener 分布式部署（CDN/VPS 分散部署）
- Malleable C2 Profile 引擎，HTTP 流量伪装为正常业务 API

### Console — 控制端

- React 19 + TypeScript + Vite 6 构建
- HeroUI3 Pro 企业级组件库 + Tailwind CSS v4
- 交互式 Web 终端（xterm.js + WebSocket PTY）
- 海量数据虚拟列表渲染（@tanstack/react-virtual）
- WebSocket 实时多人协同，操作状态毫秒级同步
- ECharts 仪表盘可视化：Agent 地理位置分布、网络拓扑
- 多点式 DDoS 压力测试模块（8 种攻击方式）
- 不可删除的审计日志查看器
- 中英文双语界面（react-i18next）

---

## 技术栈

| 层次 | 技术 |
|---|---|
| **Agent 运行时** | .NET 10 Native AOT |
| **服务端框架** | ASP.NET Core 10 WebAPI |
| **数据库** | MongoDB 7+ |
| **实时通信** | System.Net.WebSockets（原始 WebSocket，非 SignalR） |
| **身份认证** | JWT RS256 + BCrypt 密码哈希 |
| **数据加密** | AES-256-GCM + RSA 密钥交换 |
| **前端框架** | React 19 + TypeScript 5.8 |
| **构建工具** | Vite 6 |
| **样式方案** | Tailwind CSS v4 + tailwind-variants |
| **UI 组件库** | HeroUI3 Pro（60+ 组件） |
| **图表可视化** | Recharts + ECharts |
| **终端模拟** | xterm.js |
| **国际化** | react-i18next |
| **公共库** | .NET 10 类库（共享模型、枚举、协议常量） |

---

## 快速启动

### 环境要求

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Node.js](https://nodejs.org/) 22+ (LTS)
- [MongoDB](https://www.mongodb.com/try/download/community) 7.0+

### 1. 克隆仓库

```bash
git clone https://github.com/SmaZone2020/Libra-Nextgen.git
cd Libra-Nextgen
```

### 2. 启动 MongoDB

```bash
mongod --dbpath ./data
```

或使用 Docker：

```bash
docker run -d -p 27017:27017 --name mongodb mongo:7
```

### 3. 启动服务端

```bash
cd src
dotnet restore service.sln
dotnet build service.sln

cd service
dotnet run
```

服务端默认启动在 `http://localhost:5000`。如需修改 MongoDB 连接，编辑 `src/service/appsettings.json`：

```json
{
  "MongoDB": {
    "ConnectionString": "mongodb://localhost:27017",
    "DatabaseName": "libra_nextgen"
  }
}
```

### 4. 启动前端控制台

```bash
cd src/webapp
npm install
npm run dev
```

浏览器访问 `http://localhost:5173`。首次访问会提示创建初始管理员账户。

### 5. 部署 Agent

开发模式（依赖 .NET 运行时）：

```bash
cd src/agent
dotnet run -- --server http://localhost:5000/agent
```

生产模式 Native AOT 编译：

```bash
# Linux x64
dotnet publish -c Release -r linux-x64

# Windows x64
dotnet publish -c Release -r win-x64
```

编译产物为独立原生可执行文件（约 1-2 MB），目标机器无需安装 .NET 运行时。Agent 启动后将自动注册到服务端并出现在仪表盘中。

---

## 原理解析

### Agent 生命周期

1. **构造阶段** — Agent 编译时内嵌服务端地址与 RSA 公钥。Native AOT 生成无 CLR 依赖的独立可执行文件，消除传统 .NET 程序的元数据特征。
2. **首次握手** — Agent 通过 WebSocket 连接服务端，执行 RSA 密钥协商，交换 AES-256-GCM 会话密钥。同时上报主机指纹（主机名、操作系统、硬件配置、GeoIP 位置）。
3. **任务循环** — Agent 在 WebSocket 信道上持续监听任务指令。操作员通过控制台下发的任务经服务端中继至 Agent，Agent 在内存中执行。
4. **插件加载** — 高级功能模块（凭据提取、内网穿透等）以加密 .NET DLL 形式从服务端下发，通过 `Assembly.Load()` 在内存中反射加载，全程不落盘。
5. **状态上报** — Agent 定期发送心跳、任务执行结果和状态变更，所有输出实时流式回传至控制台。

### 通信安全

- **密钥协商**: Agent 首次连接时使用 RSA-2048 加密随机生成的会话密钥，发送至服务端。
- **会话加密**: 后续所有消息均采用 AES-256-GCM 加密，每条消息携带单调递增计数器以防重放攻击。
- **流量伪装**: Malleable C2 Profile 可变换 HTTP 头部、URI 路径和载荷编码格式，伪装为正常业务 API 流量（如仿冒 REST 接口、JWT 令牌头部、Base64 图片元数据等）。

### 多人协同设计

控制台面向红队团队协作场景设计：

- 操作员使用各自账户登录（JWT Token + RBAC 权限）。
- 所有操作通过 WebSocket 实时广播——操作员 A 打开一个 Shell，操作员 B 的屏幕毫秒级同步显示。
- 所有下发指令强制写入 MongoDB 的 `AuditLogs` 集合，审计日志查看器不提供删除功能，确保赛后复盘的绝对客观性。

---

## 项目结构

```
Libra-Nextgen/
├── README.md
├── README_zh.md                      # 中文文档
├── CLAUDE.md                          # 内部设计文档
└── src/
    ├── LibraNextgen.Common/           # 公共层：共享模型、枚举、协议常量
    │   ├── Models/
    │   │   ├── Enums.cs               # CommandType、CampaignStatus 等枚举
    │   │   ├── StressTestCampaign.cs   # 压测任务 & Agent 状态模型
    │   │   └── StressConfig.cs        # 攻击配置 DTO
    │   └── Protocol/
    │       └── WebSocketMessage.cs     # WsMessageType 常量 & 消息路由
    │
    ├── agent/                         # Libra-Agent 被控端
    │   ├── Core/
    │   │   └── AgentEngine.cs         # 主循环、WS 消息处理、任务分发
    │   └── Modules/
    │       ├── StressTest/            # DDoS 压力测试模块（8 种攻击方式）
    │       │   ├── DDoSModule.cs      # 攻击编排引擎
    │       │   ├── IStressMethod.cs   # 攻击方式接口
    │       │   ├── CovertUtils.cs     # 隐蔽工具集（UA轮换/抖动/载荷随机化）
    │       │   ├── HttpFlood.cs       # HTTP 洪水
    │       │   ├── SynFlood.cs        # SYN 洪水
    │       │   ├── UdpFlood.cs        # UDP 洪水
    │       │   ├── IcmpFlood.cs       # ICMP 洪水
    │       │   ├── Slowloris.cs       # 慢速 HTTP 连接耗尽
    │       │   ├── TcpConnFlood.cs    # TCP 连接耗尽
    │       │   ├── ReflectionAmp.cs   # DNS/NTP 反射放大
    │       │   └── MalformedPacket.cs # 协议畸形包
    │       └── ...                    # 其他后渗透模块
    │
    ├── service/                       # Libra-Server 服务端
    │   ├── Controllers/
    │   │   ├── StressTestController.cs # 压测任务 REST API
    │   │   └── ...
    │   ├── Services/
    │   │   ├── StressTestService.cs   # 压测任务编排 & 状态追踪
    │   │   ├── ConnectionManager.cs   # Agent WebSocket 连接注册表
    │   │   └── ...
    │   ├── Hubs/
    │   │   └── WebSocketHandler.cs    # WS 消息路由（Agent ↔ Console）
    │   ├── Data/
    │   │   └── Repository.cs          # 泛型 MongoDB 仓储
    │   └── Program.cs
    │
    └── webapp/                        # Libra-Console 前端控制台
        └── src/
            ├── app/App.tsx            # 根组件：路由、布局、鉴权
            ├── config/site.ts         # 侧边栏导航 & 页面注册
            ├── pages/
            │   ├── Dashboard/         # 仪表盘：KPI、GeoMap、流量图
            │   ├── Agents/            # Agent 列表 & 详情面板
            │   ├── Shell/             # xterm.js 交互式终端
            │   ├── Explorer/          # 远程文件浏览器
            │   ├── Screen/            # 屏幕监控（差分压缩）
            │   ├── Media/             # 摄像头 & 麦克风监控
            │   ├── System/            # 系统信息、进程、凭据
            │   ├── Audit/             # 不可删除的审计日志
            │   ├── Builder/           # Agent 载荷生成器
            │   ├── StressTest/        # 多点式 DDoS 压测面板
            │   └── About/             # 许可证 & 免责声明
            ├── api/                   # REST API 客户端
            ├── ws/                    # WebSocket 客户端 & 事件总线
            ├── contexts/              # React Context（鉴权、Agent 等）
            ├── components/            # HeroUI Pro + 自定义组件
            ├── i18n/locales/          # 中英文翻译文件
            └── types/                 # TypeScript 类型定义
```

---

## 压力测试模块

Libra-Nextgen 内置**多点分布式 DDoS 压力测试**模块，专为企业内部基础设施抗压能力验证设计。利用多台已连接的 Agent 从不同网络节点发起分布式攻击流量。

### 攻击方式

| 层级 | 方式 | 说明 |
|---|---|---|
| 四层 | SYN Flood | TCP SYN 包洪水，随机化源 IP/端口 |
| 四层 | UDP Flood | 大流量 UDP 数据报洪水，可变载荷 |
| 四层 | ICMP Flood | ICMP Echo Request 洪水，并发突发 |
| 四层 | 反射放大 | DNS ANY + NTP monlist 放大，利用开放解析器 |
| 七层 | HTTP Flood | HTTP GET/POST 洪水，UA/Cookie/Referer 轮换 |
| 七层 | Slowloris | 慢速 HTTP 头部 drip，保持连接不释放 |
| 七层 | TCP 连接耗尽 | 大量 TCP 空闲连接占满连接表 |
| 七层 | 协议畸形包 | 畸形 TLS ClientHello、异常 HTTP 头部、垃圾载荷 |

### 隐蔽特性

- User-Agent 随机轮换（50+ 签名库）
- 请求间隔随机抖动（防止固定频率被识别）
- 载荷大小随机化
- 进程名伪装（Windows 伪装为 svchost.exe，Linux 伪装为 systemd-logind）
- 所有模块在内存中运行，磁盘无痕迹

---

## 许可证

Libra-Nextgen 依据 **GNU General Public License v3.0**（GPL-3.0）开源发布。您可以自由地再分发和/或修改本软件，但须遵循自由软件基金会发布的 GPL 许可证条款（版本 3 或更高版本）。

完整许可证文本请参阅: [GNU GPL v3](https://www.gnu.org/licenses/gpl-3.0.html)

---

## 免责声明

Libra-Nextgen **仅限**用于用户自有基础设施内的授权企业安全测试、红队行动与网络安全研究。任何对本软件的使用均须遵守所有适用的地方法律、国家法律与国际法。

**未经系统所有者明确的书面授权**，对计算机系统、网络或数据的访问均属违法行为。用户在进行任何安全评估或渗透测试活动前，必须获取适当的授权。

本工具面向**具备资质的网络安全专业人员**，使用者须理解其行为的法律与道德含义。如对预期用途的合法性存疑，请在使用前咨询法律顾问。

---

## 责任限制

Libra-Nextgen 的开发者、贡献者与分发方对因使用或无法使用本软件而产生的任何直接、间接、附带、特殊、惩戒性或后果性损害（包括但不限于替代商品或服务的采购、使用、数据或利润的损失，或业务中断）**概不负责**。

用户对使用本软件所采取的所有行动承担**全部和完全的责任**。开发者不对因使用、误用或滥用 Libra-Nextgen 而产生的任何索赔、损害或法律后果承担任何责任。

**使用 Libra-Nextgen 即表示您已阅读、理解并同意上述条款。如不同意，请勿使用本软件。**
