# AI Channels (IM Integration Layer) Design

> **Correspondence**: English version of [`../zh/ai-channels.md`](../zh/ai-channels.md) (Chinese AI channel design). Content follows the real production implementation.

> Goal: expose the built-in AI assistant Justitia to operators through IM bots (WeChat iLink / Feishu Lark / Telegram), so operators can direct the AI from their phone using everyday chat software (reusing the existing MCP toolchain and Justitia's permission system), while keeping the C2's mandatory audit, approval trail and multi-operator collaboration semantics.

---

## 1. Overall Structure

```
   Telegram ──► TelegramAdapter   (long polling getUpdates, background service)
   WeChat iLink ──► WeChatClawAdapter (iLink getupdates, background service)
   Feishu     ──► LarkChannelAdapter (WS long connection / Webhook dual-mode)
                    │
                    ▼
            AiChannelService (channel gateway)
            rate limit → identity resolve → command route → session route
            (bind /approve /reject etc.)
                    │
                    ▼
            AiService.RunChatAsync (reused)
            MCP toolchain / Justitia tier / approval
                    │
                    ▼
            ChannelSink (SSE events → IM messages)
```

Core idea: **do not rewrite the chat pipeline — only swap the event exit**. Console chat goes through SSE; channel chat goes through `ChannelSink` — implement `RunChatAsync`'s `onEvent` callback as "accumulate text → post back to IM when done". Tool calls, Justitia tier gates and pending approvals all reuse the existing logic (keyed by `sessionId` at runtime, independent of the exit).

### 1.1 The Three Adapters (all callback-free — fit intranet deployments)

| Channel | Access method | Inbound | Outbound | Notes |
| --- | --- | --- | --- | --- |
| **Telegram** | Bot API long polling | `ChannelPollingHostedService` polls `getUpdates?timeout=30` | `sendMessage` | zero dependencies, no public domain needed, easiest |
| **WeChat iLink** | WeChat ClawBot official protocol (HTTP/JSON) | polls `POST /ilink/bot/getupdates`, 35s hang (`get_updates_buf` cursor) | `POST /ilink/bot/sendmessage` (must echo `context_token`) | base `https://ilinkai.weixin.qq.com`; `bot_token` obtained via QR-code login; sessions expire (~14 days) and require re-login |
| **Feishu Lark** | official WS long connection (default, no public endpoint needed) / Webhook callback (alternative) | WS: `/callback/ws/endpoint` bootstrap → protobuf frames (event/ack/ping) | `tenant_access_token` → `/open-apis/im/v1/messages` | WS frame protocol is hand-written encode/decode (zero deps); Webhook mode uses challenge + Encrypt Key signature verification / AES decryption |

Unified abstraction `IAiChannelAdapter`: inbound messages → unified gateway processing; outbound is implemented by the adapter.

- `AiChannelService`: channel CRUD / enabled state / connection test (`/api/ai/channels*`)
- Inbound uniformly goes through the gateway: rate limit → resolve sender identity (binding) → command routing (`bind` / `/approve` / `/reject` / menu commands / group calls) → session routing (by `sessionId`)
- Outbound uniformly goes through `ChannelSink`, converting SSE events into IM messages

## 2. Binding & Identity

- **One-time bind code + deep link**: admins generate a bind code in the console; the IM bot sends `/bind <code>` or the user taps a deep link to complete binding; the sender identity maps to a console account (Operator/Admin role applies accordingly)
- Messages from unbound users are rejected with a binding prompt; bindings are persisted — switching devices requires re-binding

## 3. Approval & Commands

- **Inline-button approval**: when a tool call / high-risk action triggers the Justitia tier gate, the IM side receives `[Approve] [Reject]` inline buttons (equivalent to `/approve` / `/reject`); approval actions are written to `AuditLogs` with the same risk grading as REST, identified as the approver account
- **Menu commands**: `/menu` shows the model menu, supporting `mdl:nav:<n>` paging selection; the current model is saved with the session
- **Group calls**: @-mention the bot in a group chat to trigger; identity resolution follows bindings; session context is shared within the group

## 4. Sessions & State

- Sessions are keyed by `sessionId`, independent of the exit: a session opened in the console can continue in IM, and vice versa
- `AiChannelService` maintains per-channel state: `ProviderIndex` / `CurrentModel` / `Page` / `Query` / `Searching` (model-menu navigation and search state)
- Channel messages carry echo parameters such as `context_token` (WeChat iLink); adapters echo them on outbound to keep the session alive

## 5. Security Boundaries

- All AI interactions (including IM-directed ones) are subject to Justitia's tiered permissions: tool calls are authorized through the MCP toolchain, high-risk actions go through approval; everything is written to `AuditLogs`
- Channel credentials (`bot_token` / `tenant_access_token`, etc.) are stored encrypted; `ListChannelsAsync` does not return secrets by default (`includeSecrets: false`)
- Adapters are zero-dependency (hand-written protocols/encode-decode), require no public callback ports, and fit intranet deployments
