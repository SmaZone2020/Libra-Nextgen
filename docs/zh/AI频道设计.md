# AI 频道（IM 接入层）设计方案

> 目标：把内置 AI 助手 Justitia 通过 IM 机器人（微信 iLink / 飞书 Lark / Telegram）暴露给操作员，
> 让操作员在手机上用日常聊天软件指挥 AI（复用现有 MCP 工具链与 Justitia 权限体系），
> 并保持 C2 的强制审计、审批留痕与多人协同语义。

---

## 1. 如何实现（架构）

### 1.1 总体结构

```
                    ┌─────────────────────────────────────────────────┐
                    │                 Libra-Server                    │
                    │                                                 │
  Telegram ───────► │  TelegramAdapter   (长轮询 getUpdates, 后台服务)  │
  微信 iLink ─────► │  WeChatClawAdapter (iLink getupdates, 后台服务)  │
  飞书  ────────► │  LarkChannelAdapter (WS 长连接 / Webhook 双模式)   │
                    │        │          │          │                  │
                    │        ▼          ▼          ▼                  │
                    │  ┌───────────────────────────────────┐          │
                    │  │   AiChannelService（频道网关）      │          │
                    │  │   限流 → 身份解析 → 命令 → 会话路由   │          │
                    │  │   （/bind /approve /reject 等）     │          │
                    │  └───────────────┬───────────────────┘          │
                    │                  ▼                              │
                    │  ┌───────────────────────────────────┐          │
                    │  │   AiService.RunChatAsync（复用）    │          │
                    │  │   MCP 工具链 / Justitia 档位 / 审批  │          │
                    │  └───────────────┬───────────────────┘          │
                    │                  ▼                              │
                    │        ChannelSink（SSE 事件 → IM 消息）          │
                    └─────────────────────────────────────────────────┘
```

核心思路：**不重写聊天管线，只换事件出口**。控制台聊天走 SSE，频道聊天走 `ChannelSink`——
把 `RunChatAsync` 的 `onEvent` 回调实现为「累积文本 → 完成后回发 IM」，
工具调用、Justitia 档位门槛、审批挂起/续跑全部复用现有逻辑（运行态按 `sessionId` 键控，与出口无关）。

### 1.2 三种适配器（均为免公网回调，适配内网部署）

| 频道 | 接入方式 | 入站 | 出站 | 说明 |
| --- | --- | --- | --- | --- |
| **Telegram** | Bot API 长轮询 | `ChannelPollingHostedService` 轮询 `getUpdates?timeout=30` | `sendMessage` | 零依赖、无需公网域名，最省事 |
| **微信 iLink** | 微信 ClawBot 官方协议（HTTP/JSON） | 轮询 `POST /ilink/bot/getupdates`（~35s 挂起，`get_updates_buf` 游标） | `POST /ilink/bot/sendmessage`（须回传 `context_token`） | 基座 `https://ilinkai.weixin.qq.com`；`bot_token` 由扫码登录获得；会话过期（-14）需重新登录 |
| **飞书 Lark** | 官方 WS 长连接（默认，免公网）/ Webhook 回调（备选） | WS：`/callback/ws/endpoint` 引导 → protobuf 帧（event/ack/ping） | `tenant_access_token` → `/open-apis/im/v1/messages` | WS 帧协议手写编解码（零依赖）；Webhook 模式含 challenge + Encrypt Key 验签/AES 解密 |

统一抽象：

```csharp
public interface IAiChannelAdapter
{
    string ChannelType { get; }                       // "telegram" | "lark" | "wechat-claw"
    Task SendTextAsync(AiChannel ch, string externalId, string text, CancellationToken ct);
    Task<(bool Ok, string Message)> TestAsync(AiChannel ch, CancellationToken ct);
    Task<ChannelPollBatch> PollAsync(AiChannel ch, string? cursor, CancellationToken ct);
}
```

### 1.3 入站管线（AiChannelService.HandleInboundAsync）

```
原始消息 → 规范化 ChannelInboundMessage { channelId, externalId, externalName, text }
  ├─ 1. 限流：按 (channelId, externalId) 固定窗口（10 条/分钟），超限回「操作过于频繁」
  ├─ 2. 命令处理：/start /help /status /bind <code> /approve [permit] /reject
  ├─ 3. 身份解析：查 ai_channel_users → boundUserId；requireBind 且未绑定 → 回绑定指引
  ├─ 4. 会话路由：get-or-create 频道会话（见 §3）
  ├─ 5. 并发闸：同一 externalId 同时只允许一个运行（SemaphoreSlim）
  └─ 6. AiService.RunChatAsync(session, text, ChannelSink, tier=频道档位)
```

### 1.4 审批：IM 内直接审批，控制台接管

工具调用超出当前档位时，`RunChatAsync` 挂起并推 `approval` 事件。频道的 `ChannelSink` 收到后：

1. 向 IM 回发审批卡：「⏳ Justitia 请求审批：工具「X」+ 参数摘要」+ 操作指引；
2. 通过 WebSocket 广播（`WebSocketMessage` 类型 `ai.channel`）通知控制台；
3. 操作员**两个入口都可决策**：
   - **IM 内**：回复 `/approve`（批准，可 `/approve 5min`/`20min` 临时提档）或 `/reject`——
     身份 = `(channelId, externalId)`，只能审批自己频道会话的挂起调用；
   - **控制台**：打开该频道会话（绑定用户可见）→ 审批模态框（打开会话时自动恢复挂起审批）。
4. 决策写入现有 `_approvalGates` 门闩 → 原运行续跑 → `ChannelSink` 把最终结果推回 IM。

同一运行由 sessionId 键控，IM 与控制台审批走完全同一条 `ResolveApprovalAsync` 路径，
后到者因门闩已清而返回「审批已失效」，天然防重复决策。

---

## 2. 信息怎么存储

### 2.1 新集合 `ai_channels`（频道配置，管理员管理，无需重启）

```csharp
public class AiChannel
{
    string Id;
    string Name;
    string ChannelType;        // telegram | lark | wechat-claw
    bool Enabled;
    Dictionary<string,string> Config;   // 类型相关配置（botToken/appId/appSecret/transport…）
    int DefaultTier;           // 该频道会话的 Justitia 基准档位（默认 Cognitio=0）
    bool RequireBind;          // 是否强制绑定控制台账号（默认 true）
    string DefaultProviderId;  // 默认 AI 供应商（空 = 取第一个启用供应商）
    string DefaultModel;
    DateTime CreatedAt; DateTime UpdatedAt;
}
```

- 敏感配置项（`botToken` / `appSecret` / `encryptKey`）落库前用现有
  `AiService.EncryptKey`（Windows DPAPI / 非 Windows 明文回退）加密，API 永不回传明文（打码 `********`）。
- 与 `AiProvider` 同模式：**数据库即配置**，前端设置页管理。

### 2.2 新集合 `ai_channel_users`（绑定关系）+ `ai_channel_bind_codes`（一次性绑定码）

```csharp
public class AiChannelUser      // 唯一索引 (ChannelId, ExternalId)
{
    string Id; string ChannelId; string ExternalId;   // Telegram chatId / 飞书 open_id / 微信 userId
    string ExternalName;         // IM 昵称
    string BoundUserId; string BoundUserName;         // 绑定的控制台账号
    int? TierOverride;           // 可选：按用户覆盖频道默认档位
    DateTime CreatedAt; BoundAt; LastSeenAt;
}

public class AiChannelBindCode  // 只存 SHA-256；15 分钟过期；CAS 一次性；索引 (ChannelId, ExpiresAt)
{
    string Id; string ChannelId;
    string BoundUserId; string BoundUserName;         // 管理员生成时指定目标账号
    string CodeHash; DateTime ExpiresAt; DateTime? UsedAt;
    string? UsedByExternalId; string? UsedByExternalName;
}
```

### 2.3 消息与会话：复用 `ai_sessions`，加频道标记

`AiSession` 增加四个**平面字段**（便于索引与过滤）：

```csharp
string? ChannelId;            // null = 控制台会话；非 null = 频道会话
string? ChannelType;
string? ChannelExternalId;
string? ChannelExternalName;
```

- 消息历史、工具调用、推理步骤全部复用 `AiSession.Messages`（同一套渲染结构）。
- 唯一索引 `(ChannelId, ChannelExternalId)`，带 `partialFilterExpression`
  （`ChannelId` 为 string），避免控制台会话（双 null）互撞。
- 会话 `UserId` 写**绑定的控制台用户**，现有「会话按用户隔离」校验、审批权限零改动生效。

### 2.4 审计

复用 `AuditService`（AI 工具调用的风险随档位重载版本）。`UserId` = 绑定用户，
`UserName` = `"{绑定用户}({频道}:{外部昵称})"`，绑定/解绑动作单独落审计，全链路可追溯。

---

## 3. 会话怎么和普通会话区分

| 层面 | 控制台会话 | 频道会话 |
| --- | --- | --- |
| 数据 | `ChannelId == null` | `ChannelId != null`（含类型/外部 ID/昵称） |
| 列表 API | `GET /api/ai/sessions`（服务端过滤 `ChannelId == null`） | `GET /api/ai/channels/sessions`（绑定用户自己的频道会话） |
| 运行态 | `AiRunState`（按 sessionId 键控，二者共用同一张表） | 同左 |
| 审批 | SSE 推送 → 模态框 | IM 内 `/approve` `/reject` + 控制台模态框（打开会话自动恢复挂起审批） |
| UI | AI 页侧边栏「会话」区 | 侧边栏「频道会话」区（频道图标徽标 + 外部昵称） |

操作员从控制台打开频道会话可查看/继续对话/审批；「每会话单运行」语义保证两侧不会并发写坏上下文。

---

## 4. 权限怎么界定

### 4.1 身份模型：频道用户 ≠ 控制台账号

IM 侧没有 JWT，身份 = `(channelId, externalId)`。访问控制分两层：

1. **绑定层（能不能用）**：管理员在设置页生成一次性绑定码（指定目标控制台账号）→
   用户在 IM 发 `/bind <code>` → 绑定完成。`RequireBind=true`（默认）时未绑定用户
   只能收到绑定指引，**拿不到任何 AI 能力**。
2. **档位层（能用什么工具）**：频道会话档位 = `channel.DefaultTier`（管理员配置，
   默认 Cognitio=只读），可按用户 `TierOverride`。档位由服务端在 `RunChatAsync`
   强制校验，超档工具一律挂起审批——**频道档位不信任客户端**。

### 4.2 管理面

| 操作 | 权限 |
| --- | --- |
| 频道 CRUD / 启停 / 测试连接 / 生成绑定码 / 绑定用户管理（档位覆盖、解绑） | Admin（`[Authorize(Roles = "Admin")]`，与 AiProvider 一致） |
| 查看自己的频道会话 / 从中发消息 / IM 审批 / 控制台审批 | 绑定用户本人（会话所有权校验） |
| 飞书 Webhook 回调（仅 webhook 模式） | `[AllowAnonymous]`（以频道自身校验：challenge + Encrypt Key 验签） |

### 4.3 纵深防御

- 限流：`(channelId, externalId)` 10 条/分钟 + 单条 2000 字符上限；
- 密钥静态加密（DPAPI）；API 出参打码；绑定码哈希存储、一次性、15 分钟过期；
- 默认安全：`RequireBind=true`、`DefaultTier=Cognitio`；
- 审批请求在 IM 侧展示参数摘要（截断 500 字符），完整参数控制台可见；
- 访客模式（`RequireBind=false`）：会话归属合成用户，档位强制 Cognitio，
  超档工具 3 秒后自动拒绝（控制台无人可审批）。

---

## 5. 配置入口在哪里

1. **后端静态默认值**：适配器内置默认基座（Telegram API / iLink `https://ilinkai.weixin.qq.com` / 飞书 `open.feishu.cn`），
   不依赖 appsettings。
2. **运行时配置（主入口）**：设置页新增 **「AI 频道」Tab**（`/settings/channels`，adminOnly，
   紧挨现有 `AI` Tab）：
   - 频道列表：名称 / 类型徽标 / 启用开关 / 默认档位 / 传输方式 / 需绑定标记；
   - 新建/编辑模态框：按频道类型动态显示字段（Telegram：Bot Token；Lark：App ID/Secret/
     transport（长连接|Webhook）+ 可选校验 Token/Encrypt Key；iLink：基座地址 + bot_token）；
   - 「生成绑定码」：选目标控制台账号 → 8 位码（15 分钟有效，一次性，可复制）；
   - 「绑定用户」：列表 + 按用户档位覆盖 + 解绑；
   - 测试连接（新建草稿也可测）。
3. **AI 页侧边栏**：「会话」与「频道会话」分区（频道图标徽标），绑定用户可查看/继续/审批。
4. **IM 侧**：`/start` `/help` `/status` `/bind <code>` `/approve [one-time|5min|20min]` `/reject`。

---

## 6. 微信 iLink（ClawBot）接入说明

微信 ClawBot 背后的协议即**微信官方 iLink Bot API**（HTTP/JSON），
协议文档：<https://www.wechatbot.dev/zh/protocol>，基座默认 `https://ilinkai.weixin.qq.com`。

- **登录**：`GET /ilink/bot/get_bot_qrcode?bot_type=3` 拿二维码 → 轮询
  `GET /ilink/bot/get_qrcode_status?qrcode=...` → 确认后获得 `bot_token`（Bearer）与 `baseurl`；
- **收消息**：`POST /ilink/bot/getupdates`（长轮询 ~35s），body
  `{ get_updates_buf: <不透明游标>, base_info: { channel_version: "2.0.0", bot_agent } }`，
  响应含 `msgs[]`（`from_user_id` / `context_token` / `item_list[].text_item.text`）与新的 `get_updates_buf`；
- **发消息**：`POST /ilink/bot/sendmessage`，**必须回传入站消息的 `context_token`**
  （按用户缓存，跨重启丢失需重新触发）；`ret: 0` 成功，`-14` 会话过期需重新扫码；
- **请求头**：`AuthorizationType: ilink_bot_token` + `Authorization: Bearer <bot_token>` +
  `X-WECHAT-UIN: base64(十进制随机uint32)` + `iLink-App-Id: bot` + `iLink-App-ClientVersion`。

> ⚠️ 会话过期（-14）后 `ChannelPollingHostedService` 会退避重试并在日志提示重新登录；
> 设置页更新 `bot_token` 后自动恢复。扫码登录的 UI 化（设置页内直接扫码）列为后续迭代。

---

## 7. 落地清单（对应本仓库代码）

| 文件 | 内容 |
| --- | --- |
| `src/LibraNextgen.Common/Models/AiModels.cs` | `AiChannel` / `AiChannelUser` / `AiChannelBindCode` / `AiSession` 频道字段 |
| `src/service/Services/AiChannelService.cs` | 频道网关：CRUD、绑定码、入站管线、IM 审批、ChannelSink |
| `src/service/Services/ChannelAdapters.cs` | `IAiChannelAdapter` + Telegram / Lark / 微信 iLink 实现 |
| `src/service/Services/LarkWsChannelService.cs` | 飞书长连接：protobuf 帧编解码 + 后台服务 |
| `src/service/Services/ChannelPollingHostedService.cs` | Telegram / iLink 长轮询后台任务 |
| `src/service/Controllers/AiChannelController.cs` | 管理/用户 API（CRUD/绑定码/用户/测试/频道会话） |
| `src/service/Controllers/AiChannelWebhookController.cs` | 飞书 Webhook 回调（challenge/AES），`[AllowAnonymous]` |
| `src/service/Program.cs` | DI 注册（适配器 + 网关 + 两个后台服务） |
| `src/service/Data/MongoIndexBuilder.cs` | 新索引（会话频道唯一索引 / 绑定唯一 / 绑定码） |
| `src/service/Services/AiService.cs` | 控制台会话过滤 + 频道会话 get-or-create + 挂起审批查询 |
| `src/webapp/src/api/aiChannels.ts` | 前端 API 客户端 |
| `src/webapp/src/pages/Settings/ChannelsTab.tsx` + `ChannelFormModal.tsx` | 配置入口（频道管理/绑定码/绑定用户） |
| `src/webapp/src/pages/Ai/AiSidebar*.tsx` + `index.tsx` | 频道会话分区 + 徽标 + 挂起审批恢复 |
