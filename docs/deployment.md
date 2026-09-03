# Libra-Nextgen 部署手册

> **生产/自助部署推荐 Docker（§6.2）**：一条命令起 MongoDB + Server + nginx（内网 HTTP / 公网 HTTPS 均可）。
> 裸机部署见 §3–§5，开发环境见 §0。

## 0. 开发环境快速启动

> 完整的环境安装与启动步骤见 [README 快速开始](../README.md)（含各依赖下载地址与验证命令）。

**依赖**：MongoDB 7.0+（先启动）· .NET SDK 10 · Node.js 20+（Rust 1.80+ 仅在线构建载荷时需要）。

```bash
# 1. Server（http://localhost:5270）
cd src/LibraNextgen.Server && dotnet run
# 2. Console（http://localhost:5173，首次访问 /setup 建管理员）
cd src/console && npm install && npm run dev
```

## 1. 架构总览

```
┌─────────────┐   HTTPS/HTTP   ┌──────────────┐        ┌────────────┐
│ 前端 Console │ ─────────────▶ │  nginx 反代   │ ─────▶ │ Libra-Server│
│ (React SPA) │  /api /ws/console│  (TLS)      │        │ (ASP.NET)  │
└─────────────┘                └──────────────┘        └─────┬──────┘
                                                            │
              ┌──────────────────────────────────────────────┤
              │                                              │
   ┌──────────▼─────────┐                          ┌─────────▼─────────┐
   │ MongoDB            │                          │ build-output/     │
   │ libra_nextgen 库    │                          │ 模块/构建产物/密钥  │
   └────────────────────┘                          └───────────────────┘
```

**两条通道**:

- **Agent ↔ Server**(beacon,无 WebSocket):Agent 以固定间隔 HTTPS 轮询
  (注册/心跳/结果上报),任务事件通过 SSE 长连接推送。全部伪装为正常 API 调用:
  - `POST /v1/chat/completions` — AI 通道:注册/心跳/结果/模块下载(密文)
  - `GET  /api/v1/models/events` — SSE 任务事件流(长连接,30s keepalive)
  - `GET  /api/v1/models/{id}`    — loader 下载 core.bin(一次性凭证)
  - `POST /api/v1/session`        — agent 注册(OAuth 风格混合加密)

- **Console ↔ Server**(REST + WebSocket):控制台走 REST 管理 API,实时状态/推送
  走 `WS /ws/console?token=…`。nginx 无需为 Agent 配置 WebSocket upgrade
  (Agent 侧零 WS),但控制台的 `/ws/console` 需要 upgrade 支持(见 §4)。

## 2. 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `LIBRA_SERVER_KEY` | 公网必填 | 服务端 RSA 私钥 PEM 文件路径（部署级，agent 注册/密钥协商用）。**必须持久化**——首次启动自动生成 `server-rsa.key`，服务重启/换 key 会导致所有在线 agent 需要重注册（会自愈，但会断线一次）。建议生成后固定路径 |
| `LIBRA_BUILDS_DIR` | 公网必填 | 构建产物目录绝对路径（agent 可执行文件、模块 dll、core.bin）。**Builder 与模块下发共用**（均读取本变量；未设置时回退基目录相对路径，发布/容器部署下会失效，务必显式设置）。容器部署默认 `/build-output` |
| `LIBRA_AGENT_RS_DIR` | 可选 | agent-rs 源码工作区路径（Builder 编译用）。未设置时回退仓库开发布局；容器部署默认 `/agent-rs`（挂载自定义源码可覆盖） |
| `Beacon__Secret` | 可选 | 共享密钥（旧式预会话加密兜底）。新协议（混合加密）不需要；不设置则旧 agent 的加密注册被拒绝 |
| `MongoDB__ConnectionString` | 默认 | Mongo 连接串，默认 `mongodb://localhost:27017` |
| `ASPNETCORE_ENVIRONMENT` | 生产设 `Production` | 控制异常详情页（生产只返回统一 JSON 错误） |

## 3. 数据库（MongoDB）

- 库名 `libra_nextgen`（`MongoDB__DatabaseName` 可覆盖）
- **生产必须启用认证**：创建专用用户，连接串 `mongodb://user:pass@host:27017/libra_nextgen?authSource=admin`
- 集合：`agents` / `tasks` / `users` / `session_keys` / `session_tokens` / `build_lists` / `plugins` / `audit_logs` 等（启动时自动建索引）

## 4. nginx 配置（公网）

```nginx
server {
    listen 443 ssl;
    server_name ai.yuxiit.cn;

    # TLS（必须）：HTTP 明文下所有伪装路径/Header 直接暴露
    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # 大请求体：模块下载结果/大任务结果（建议 ≥30MB）
    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:5270;
        proxy_http_version 1.1;
        # SSE 长连接（Agent 事件流）：read/send 超时必须 > keepalive 间隔（30s），建议 120s
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;               # SSE 必须关缓冲
        # 控制台实时推送 /ws/console 需要 WebSocket upgrade
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# 可选：HTTP → HTTPS 跳转
server {
    listen 80;
    server_name ai.yuxiit.cn;
    return 301 https://$host$request_uri;
}
```

## 5. 密钥管理

| 密钥 | 位置 | 说明 |
|---|---|---|
| 服务端 RSA（agent 混合加密） | `LIBRA_SERVER_KEY` 指定文件 | 私钥权限 `600`；丢失 = 全部 agent 需重新构建部署 |
| JWT RSA（控制台登录） | `%APPDATA%/Libra-Nextgen/jwt-rsa-key.bin`（Windows DPAPI） | 部署机首次启动生成；备份该文件 |
| core.bin AES 密钥 | `build-output/{buildId}/core.key` | 每次构建生成，随构建目录保留 |
| Mongo 凭据 | 连接串 | 生产启用认证 |

## 6. 构建与升级

1. 部署新服务端：替换二进制 + 重启（agent 会话通过 `session_keys`/`session_tokens` 持久化自动恢复）
2. 重新构建 agent：Builder 页面「生成」（core 走 prebuilt 秒级 + 模块按需编译）
3. 模块变更：Builder 页面「模块管理」→ 勾选 → 「构建模块」
4. 前端：构建 SPA 产物部署到静态目录（或同域反代）
5. 插件页面：**无需重建前端**——插件以 zip 导入后由服务器运行时提供
   （`/api/plugins/{id}/page/**`），刷新控制台即生效

> 版本兼容提示：loader 下载带一次性凭证（downloadToken），旧 loader 在无凭证
> 请求时会被 401 拒绝——升级后需重新构建 loader 与 agent。

## 6.1 云载模块与插件 stage

构建产物结构（`LIBRA_BUILDS_DIR`）：

```
build-output/
├── agent.exe / agent 等载荷产物
└── modules/{x64,linux-x64}/*.dll|.so   # Agent 云载模块（按需下载源）
```

- 内置模块：`shell`、`recon`、`creds`、`files`、`powershell`、`proxy`、`script`（QuickJS JS 引擎）、`token`。Agent 首次使用某类任务时按需下载，**内存加载零落盘**。
- **插件 native 模块的 stage 流程**：插件导入/启用时，`PluginService.StageModules` 把 zip 内 `module/<platform>/*.dll|.so` 复制到 `build-output/modules/<platform>/`；Agent 执行插件动作时按 `module.name` 下载。
- ⚠️ 重新构建/重建 `build-output` 后插件 dll 可能被清掉，插件动作会报 `module download failed: 404`——在插件管理页**禁用再启用**即可重新 stage。
- Agent 的 `ModuleManager` 对已加载模块有内存缓存：更新 native 模块后需**重启 Agent** 才会重新下载。

## 6.2 Docker 部署（推荐，linux/amd64）

面向自助部署场景：一条命令起全套（MongoDB + Server + nginx），镜像内置 Rust/zig 工具链，
可在容器内在线构建 win x64 / win x86（GNU ABI 交叉编译）与 linux-x64 agent。
服务端镜像仅支持 linux/amd64。

### 目录（`deploy/`）

| 文件 | 说明 |
|---|---|
| `Dockerfile` | 三阶段构建：控制台 SPA → dotnet publish → 运行镜像（含 rustup + zig + cargo-zigbuild） |
| `docker-compose.yml` | mongo:7 + server + nginx 三服务；五个命名卷持久化 |
| `.env.example` | 环境变量模板（复制为 `.env` 后填写） |
| `nginx/console.conf` | nginx 站点配置（SPA 静态 + API/SSE/WS/MCP 分段反代；含 TLS 示例） |
| `docker/entrypoint.sh` | 容器入口：准备持久化目录后启动服务 |

### 快速开始

前置：Docker Engine 24+ 与 Compose v2。

```bash
cd deploy
cp .env.example .env
# 编辑 .env：至少填写 VITE_API_BASE（控制台的公共访问源，如 https://c2.example.com）
docker compose up -d --build
```

浏览器访问 `VITE_API_BASE` 对应地址，首次访问 `/setup` 创建管理员。

**单端口说明**：`VITE_API_BASE` 在构建镜像时写入前端，控制台的 API/SSE/WS 全部请求该源并经 nginx 443 进入；
agent/beacon 也走 443。改域名/端口需 `docker compose up -d --build` 重建镜像。

### 持久化（五个命名卷）

| 卷 | 挂载点 | 内容 |
|---|---|---|
| `mongo-data` | `/data/db` | MongoDB 全部数据（含审计日志） |
| `libra-builds` | `/build-output` | 构建产物、模块、`artifacts/`、共享 cargo 缓存（`target-shared`） |
| `libra-config` | `/root/.config/Libra-Nextgen` | JWT RSA 密钥 + 监听设置 |
| `libra-secrets` | `/secrets` | 服务端 RSA 私钥（首次启动自动生成） |
| `console-dist` | `/srv/console-live` → `/usr/share/nginx/html` | 控制台 SPA（容器入口每次启动从镜像同步），可安全删除、由镜像重建 |

删除容器不影响卷；备份/迁移 = 把四个卷与 `.env` 一并拷贝。

### TLS

1. 将 `fullchain.pem` / `privkey.pem` 放入 `deploy/certs/`
2. 取消 `nginx/console.conf` 中 443 server 块注释（或将 80 改为 301 跳转）
3. `.env` 中 `VITE_API_BASE` 改为 https 前缀，重建镜像

### 在线构建 agent

- Builder 平台：win x64 / win x86 / linux-x64 均可直接生成；win 载荷为 **GNU ABI**（zig 交叉），
  与 Windows 开发机上的 MSVC 产物功能等价、可并存。
- 首次构建某平台会现场编译（容器需联网拉取 crates，依赖已预取入镜像层并缓存在卷）；
  `artifacts/{platform}/core.bin` 命中后秒级完成。

### 升级

- 本地构建：`git pull && docker compose up -d --build`
- 镜像发布：GitHub Actions 推送 `ghcr.io/<owner>/<repo>`（tag `latest` / `sha-<id>` / `v<tag>`），
  部署机 `docker compose pull` 后 `up -d`。

### 从裸机/Windows 部署迁移

1. MongoDB：`mongodump` 导出 → 容器内 `mongorestore`（或直接拷贝 `mongo-data` 卷）
2. 构建产物：拷贝原 `build-output/` 到 `libra-builds` 卷
3. 密钥：`LIBRA_SERVER_KEY` 指定的私钥文件、`%APPDATA%/Libra-Nextgen` 目录（JWT 密钥）
4. 全新部署无存量数据时，首次启动自动生成全部密钥

### 已知限制（v1）

- 服务端镜像仅 linux/amd64
- 默认 HTTP，TLS 需按上文启用；Mongo 默认不开启认证（生产建议启用，见 §3）
- 容器以 root 运行、镜像不做签名（OpSec 增强列入后续版本）

## 7. 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| agent 反复重注册 | 服务端 RSA key 与构建注入公钥不匹配 | 确认 `LIBRA_SERVER_KEY` 指向构建时所用的同一密钥；重建 agent |
| 模块下载 404 | `LIBRA_BUILDS_DIR` 未指向模块目录 / 模块未构建 | 检查环境变量；Builder「构建模块」 |
| SSE 秒断 | nginx `proxy_read_timeout` 小于 keepalive 30s | 调大至 120s |
| 任务无响应 | agent 离线 / SSE 未连接 | 看 agent 日志（debug 构建）与 Dashboard 在线状态 |
| loader 下载 401 | loader 版本旧（无 downloadToken） | 重新构建 loader（凭证机制从本版本起强制） |
| 控制台 500 但无详情 | 生产环境全局异常处理（正确行为） | 看服务端日志（LogError 含 Path/Method） |
| 容器内 win-x64 载荷构建失败 | zig / cargo-zigbuild 缺失或版本不配对 | 容器内执行 `zig version`；调整 `ZIG_VERSION` 重建镜像 |
| 容器重启后登录态失效 | `libra-config` 卷缺失或被清 | 确认 compose 卷存在；JWT 密钥持久化在 `/root/.config/Libra-Nextgen` |
