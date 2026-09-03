# Operations Manual

> **Correspondence**: English version of [`../zh/operations.md`](../zh/operations.md) (Chinese operations manual). Content follows the real production implementation.

## First Login

1. Start Server and Console (see [README Quick Start](../../README_en.md) or the [Deployment Manual](../deployment.md)):
   - Server: `cd src/LibraNextgen.Server && dotnet run` (port 5270; MongoDB must be started first)
   - Console: `cd src/console && npm install && npm run dev` (port 5173)
2. Open <http://localhost:5173> in a browser → `/setup` to create the admin account
3. After signing in you land on the main dashboard

## Agent Onboarding

1. Console → **Builder** page: build a payload for the target platform online (Win/Linux)
2. Run the artifact (exe / binary) on the target machine; the Agent auto-registers and establishes an encrypted session
3. The Agent appears in the top device picker (online devices only)

Note: Agent-side modules are downloaded from the Server on demand; the first execution of a task family (Shell/file/recon) may be slightly slower — this is expected.

## Interactive Shell

1. Select an online Agent at the top → **Terminal** page
2. Type a command and press Enter; Tab completion, arrow keys and history are supported (xterm.js + PTY)
3. Switching Agents rebinds to a new session

> Known limitation: mixed CJK/Latin content may misalign character columns slightly (CJK double-width rendering depends on the font).

## File Management

- Paged browsing, upload/download (streaming, live progress & speed), in-archive browsing, timestomping
- Large downloads use a 2MB chunked relay with server-side write-through; cancellable

## Software Data

The 「Software Data」 page shows tabs by Agent platform (SSH cross-platform; RDP/Token Windows only):

| Tab | Description | Platform |
| --- | --- | --- |
| SSH | ~/.ssh key scan | Cross-platform |
| RDP | Credential Manager + .rdp files | Windows |
| Token | Local token collection | Windows |

> WeChat / QQ data have moved to plugins: `com.libra.wechat-file` (WeChat account dirs & monthly file dirs),
> `com.libra.qqkey` (QQ ClientKey + QQ Zone jump). Install the matching plugin and enter from **Plugin Management**.

## Installing Plugins

Three ways (plugin management page):

1. **Upload plugin**: pick a zip → import and enable
2. **Import from Git**: paste a Git link → the server clones it (repo name becomes pluginId; meta.json required at repo root)
3. **Plugin Market**: one-click install from the Libra-Plugins index (browser cache 1 hour)

After enabling: Agent-side modules are downloaded on first trigger; **plugin pages do NOT require rebuilding the frontend** — pages are served by the server at runtime (HTML+JS+CSS, interacting with the host through the injected `window.Libra` SDK). After import, **refresh the Console page** and the plugin appears under the 「Plugin Management」 group in the sidebar.

## MCP Access

- Endpoint: `http://localhost:5270/mcp` (Streamable HTTP)
- Auth: AccessKey (`Authorization: Bearer lnk_xxx`), created in the Console settings page or via API
- Tool inventory: `GET /api/mcp/info`
- AI clients can call directly: task execution, files, credentials, plugin actions, etc.
- Security boundaries:
  - All MCP tool calls are written to `AuditLogs` (same risk grading as REST; identity is the access-key owner)
  - Destructive / credential tools (`delete_agent`, `delete_file`, `get_rdp_credentials`, `get_ssh_keys`, `kill_process`, `spawn_process`) require an **Admin**-role key
  - `/mcp` is rate-limited per key (default 120 req/min), adjustable via the `mcp` policy in `Program.cs`
- fork-and-run (`forkexec` cloud module): `execute_process` runs a program in an independent child process and waits for the result (supports args/env/cwd/timeout; a child crash does not affect the Agent); `spawn_process` starts a detached background process and returns the PID (requires Admin)
- Sensitive module isolation: `creds` (RDP/SSH credentials) executes in an Agent child process (Linux fork isolation — a crash only loses the child; Windows falls back to in-process execution)
- Plugin scripts can call `exec.run(program, args, {env, cwd, timeoutSeconds})` / `exec.spawn(program, args, {env, cwd})` to run programs in a child process

## Audit & Risk Policy

- All commands go to `AuditLogs` (append-only; no delete entry in the UI)
- Settings → Risk policy: per action category (system/file/screen/credentials…) default risk levels with overrides
- Account management: RBAC roles (Operator/Admin), capabilities keyed by permission keys

## One-Click Cleanup

The Server provides the "competition end / cleanup" capability: it sends `kill_and_clean` to all online Agents; the Agent undoes its own persistence (registry/Cron/systemd) and exits.
