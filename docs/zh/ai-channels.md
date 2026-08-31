# AI 频道(IM 接入层)设计

> 目标:把内置 AI 助手 Justitia 通过 IM 机器人(微信 iLink / 飞书 Lark / Telegram)
> 暴露给操作员,让操作员在手机上用日常聊天软件指挥 AI(复用现有 MCP 工具链与
> Justitia 权限体系),并保持 C2 的强制审计、审批留痕与多人协同语义。

---

## 1. 总体结构

```
   Telegram ──► TelegramAdapter   (长轮询 getUpdates, 后台服务)
   微信 iLink ──► WeChatClawAdapter (iLink getupdates, 后台服务)
   飞书     ──► LarkChannelAdapter (WS 长连接 / Webhook 双模式)
                    │
                    ▼
            AiChannelService(频道网关)
            限流 → 身份解析 → 命令路由 → 会话路由
                    │
                    ▼
            AiService.RunChatAsync(复用)
            MCP 工具链 / Justitia 档位 / 审批
                    │
                    ▼
            ChannelSink(SSE 事件 → IM 消息)
```

核心思路:**不重写聊天管线,只换事件出口**。控制台聊天走 SSE,频道聊天走
`ChannelSink`——把 `RunChatAsync` 的 `onEvent` 回调实现为"累积文本 → 完成后回发 IM"。
工具调用、Justitia 档位门槛、审批挂起全部复用现有逻辑(运行时按 `sessionId` 键控,
与出口无关)。

### 1.1 三种适配器(均为免公网回调,适配内网部署)

| 频道 | 接入方式 | 入站 | 出站 | 说明 |
| --- | --- | --- | --- | --- |
| **Telegram** | Bot API 长轮询 | `ChannelPollingHostedService` 轮询 `getUpdates?timeout=30` | `sendMessage` | 零依赖、无需公网域名,最省事 |
| **微信 iLink** | 微信 ClawBot 官方协议(HTTP/JSON) | 轮询 `POST /ilink/bot/getupdates`,35s 挂起(`get_updates_buf` 游标) | `POST /ilink/bot/sendmessage`(须回传 `context_token`) | 基础 `https://ilinkai.weixin.qq.com`;`bot_token` 由扫码登录获得;会话过期(~14 天)需重新登录 |
| **飞书 Lark** | 官方 WS 长连接(默认,免公网) / Webhook 回调(备选) | WS:`/callback/ws/endpoint` 引导 → protobuf 帧(event/ack/ping) | `tenant_access_token` → `/open-apis/im/v1/messages` | WS 帧协议手写编解码(零依赖);Webhook 模式走 challenge + Encrypt Key 验签/AES 解密 |

统一抽象 `IAiChannelAdapter`:入站消息 → 网关统一处理;出站由适配器实现发送。

- `AiChannelService`:频道 CRUD / 启用状态 / 测试连接(`/api/ai/channels*`)
- 入站统一经网关:限流 → 身份解析 → 命令路由 → 会话路由;
  命令路由支持 bind、approve、reject、菜单指令与群组调用
- 出站统一走 `ChannelSink` 把 SSE 事件流转为 IM 消息

## 2. 绑定与身份

- **一次性绑定码 + 深链**:管理员在控制台生成绑定码,IM 机器人发送 `/bind <code>`
  或点击深链完成绑定,发送者身份映射到控制台账户
- 未绑定用户的消息被拒绝并提示绑定;绑定关系持久化,换设备需重新绑定

## 3. 审批与命令

- **内联按钮审批**:工具调用/高风险动作触发 Justitia 档位门槛时,IM 侧收到
  `[通过] [拒绝]` 内联按钮(`/approve` / `/reject` 等价指令);审批动作写入 AuditLogs,
  与 REST 相同的风险分级,身份为审批人账户
- **菜单指令**:`/menu` 展示模型菜单,支持 `mdl:nav:<n>` 翻页选择,当前模型随会话保存
- **群组调用**:群聊中 @机器人 触发,身份解析按绑定关系,群组内共享会话上下文

## 4. 会话与状态

- 会话按 `sessionId` 键控,与出口无关:控制台开的新会话可在 IM 中继续,反之亦然
- `AiChannelService` 维护每频道状态:`ProviderIndex` / `CurrentModel` / `Page` /
  `Query` / `Searching`(模型菜单导航与搜索状态)
- 频道消息含 `context_token`(微信 iLink)等回传参数,适配器在出站时回传以维持会话

## 5. 安全边界

- 所有 AI 交互(含 IM 指挥)受 Justitia 分级权限约束:工具调用经 MCP 工具链鉴权,
  高风险动作走审批;全部写入 `AuditLogs`
- 频道凭据(`bot_token` / `tenant_access_token` 等)加密存储,`ListChannelsAsync`
  默认不返回密钥(`includeSecrets: false`)
- 适配器零依赖(手写协议/编解码),无公网回调端口需求,适配内网部署
