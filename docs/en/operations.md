# Operations

## First Login

1. Start Server + Console (see [Deployment & Building](deployment.md))
2. Open the Console → `/setup` and create the admin account
3. Sign in

## Agent Onboarding

1. Console → **Builder** page: build a payload for the target platform (Win/Linux)
2. Run the artifact on the target; the Agent registers and establishes an encrypted session
3. The top agent picker shows the Agent (online only)

Note: modules are downloaded per need — first execution of a task family (shell/files/recon) may be slightly slower.

## Interactive Shell

1. Select an online Agent → **Terminal** page
2. Type commands; Tab completion, arrow keys and history work (xterm.js + PTY)
3. Switching Agents rebinds a new session

> Known limitation: CJK/Latin mixed content may misalign columns (CJK is rendered double-width and depends on font fallback).

## Files

- paged browsing, upload/download (streaming, live progress + speed), in-archive browsing, timestomping
- large downloads use 2MB chunked relay with server-side write-through; cancellable

## Screen / Camera / Microphone

- Screen: list → bind → live stream (fps/quality/screen index adjustable)
- Camera: list → bind (single-threaded COM capture) → stream
- Microphone: list → bind sampling
- All support unbind; Windows-only

## Software Data

The 「Software Data」 page shows tabs by Agent platform:

| Tab | What | Platform |
| --- | --- | --- |
| WeChat | WeChat account dirs & month file dirs | Windows |
| Browser | password/history search & export | Windows |
| SSH | ~/.ssh key scan | cross-platform |
| RDP | Credential Manager + .rdp files | Windows |

> QQ functionality moved to the `com.libra.qqkey` plugin (ClientKey probe + QQ Zone link).

## Installing Plugins

Three ways (plugin management page):

1. **Upload**: pick a zip → import & enable
2. **Import from Git**: paste a Git URL → the server clones it (repo name = pluginId; meta.json at root)
3. **Plugin Market**: one-click from the Libra-Plugins index (1h browser cache)

After enabling: the Agent downloads the module on first action; frontend pages become visible after rebuilding the frontend repo (`src/webapp/src/plugins/<pluginId>/index.tsx`) and refreshing.

## MCP

- Endpoint: `http://localhost:5270/mcp` (Streamable HTTP)
- Auth: AccessKey (`Authorization: Bearer lnk_xxx`) created in Console settings or via API
- Tool inventory: `GET /api/mcp/info`
- AI clients can drive tasks, files, credentials, plugin actions, etc.

## Audit & Risk Policy

- All commands go to `AuditLogs` (append-only; no delete path in the UI)
- Settings → Risk policy: per-action-category risk levels (system/file/screen/credentials…) with overrides
- Accounts: RBAC roles (Operator/Admin), capabilities keyed by permission

## Cleanup

The Server can issue `kill_and_clean` to all online Agents: the Agent removes its own persistence (registry/Cron/systemd) and exits.