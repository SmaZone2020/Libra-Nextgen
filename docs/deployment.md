# Libra-Nextgen 部署手册

## 0. 开发环境快速启动

> 完整的环境安装与启动步骤见 [README 快速开始](../README.md)（含各依赖下载地址与验证命令）。

**依赖**：MongoDB 7.0+（先启动）· .NET SDK 10 · Node.js 20+（Rust 1.80+ 仅在线构建载荷时需要）。

```bash
# 1. Server（http://localhost:5270）
cd src/service && dotnet run
# 2. Console（http://localhost:5173，首次访问 /setup 建管理员）
cd src/webapp && npm install && npm run dev
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
| `LIBRA_BUILDS_DIR` | 公网必填 | 构建产物目录绝对路径（agent 可执行文件、模块 dll、core.bin）。默认相对路径在发布部署下会失效 |
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

## 7. 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| agent 反复重注册 | 服务端 RSA key 与构建注入公钥不匹配 | 确认 `LIBRA_SERVER_KEY` 指向构建时所用的同一密钥；重建 agent |
| 模块下载 404 | `LIBRA_BUILDS_DIR` 未指向模块目录 / 模块未构建 | 检查环境变量；Builder「构建模块」 |
| SSE 秒断 | nginx `proxy_read_timeout` 小于 keepalive 30s | 调大至 120s |
| 任务无响应 | agent 离线 / SSE 未连接 | 看 agent 日志（debug 构建）与 Dashboard 在线状态 |
| loader 下载 401 | loader 版本旧（无 downloadToken） | 重新构建 loader（凭证机制从本版本起强制） |
| 控制台 500 但无详情 | 生产环境全局异常处理（正确行为） | 看服务端日志（LogError 含 Path/Method） |
