# Plugin Development

Plugins are delivered as a **zip package** and imported/enabled from the Console **plugin management page**. For a full tutorial see [`src/plugins/com.example.plugin-sdk/README.md`](../../src/plugins/com.example.plugin-sdk/README.md) (the SDK also ships a living-docs page inside the Console).

## The Three Layers

| Layer | Location (in zip) | Purpose | When needed |
| --- | --- | --- | --- |
| **Agent module** | `module/` | run collection/operations on the target | need Agent capabilities |
| **Frontend page** | `page/` | UI inside the Console | need custom UI/interaction |
| **Server logic** | `service/` | custom server endpoints (sandbox not loaded yet; reserved) | future |

## Zip Layout

```
plugin.zip
├── meta.json          # plugin contract (required, at zip root)
├── module/
│   ├── xxx.js            #   script channel (JS/QuickJS, no compiler, recommended)
│   ├── x64/xxx.dll    #   native channel (per-platform dirs: x64/linux-x64)
├── page/index.tsx     # frontend page source (HeroUI)
├── service/           # server logic (reserved)
└── assets/            # static assets (served at /api/plugins/<pluginId>/assets/<file>)
```

## meta.json Contract

```jsonc
{
  "schemaVersion": 1,
  "pluginId": "com.example.xxx",   // letters/digits/. /- /_ only; reverse-DNS suggested
  "name": "Plugin name",
  "version": "1.0.0",
  "author": "libra",
  "description": "one-liner",
  "entry": {
    "route": "xxx",          // page route /plugins/xxx
    "label": "nav.xxx",      // i18n key
    "icon": "Puzzle",        // @gravity-ui/icons name
    "apiRoot": "/api/plugins/com.example.xxx"
  },
  "i18n": { "zh": { "nav.xxx": "插件名" }, "en": { "nav.xxx": "Plugin" } },
  "actions": [
    {
      "action": "collect",          // action name (frontend dispatchTask)
      "label": "Collect",           // button text
      "method": "POST",
      "argsSchema": {
        "type": "object",
        "properties": { "capability": { "type": "string", "title": "capability" } },
        "required": []
      },
      "module": {
        "kind": "script",           // script=JavaScript(QuickJS) / native=cdylib
        "name": "xxx",              // .js stem or .dll/.so file name
        "op": "collect",            // injected into module input JSON as op
        "entry": "main"             // script entry fn (default main)
      }
    }
  ]
}
```

## Agent Channels

### script (JavaScript / QuickJS, recommended)

`module/xxx.js` entry `function main(args)`; `args` is the server-assembled input (includes `op`); the return value is JSON-serialized as the result:

```js
function main(args) {
    const op = args.op ?? "all";
    let out;
    if (__platform() === "windows") {
        out = cmd("whoami");                 // Windows: CMD
    } else {
        out = shell("uname -a");             // Linux/macOS: /bin/sh
    }
    return { op, out };
}
```

The sandbox is a bare QuickJS runtime (no `fetch`/`require`/`console`/`eval`; use `log()` for logging). Branch per-platform **at runtime** with `__platform()` (returns `"windows" | "linux" | "macos" | "unknown"`); platform-specific functions are registered only on their platform. API quick reference:

| Common | Windows | Linux/macOS |
| --- | --- | --- |
| `fs.read/write/list/exists` | `cmd` / `powershell` | `shell` / `bash` |
| `proc.list()/kill(pid)` | `reg_query/set/delete` | `uname` / `hostname` |
| `env.get` / `whoami` / `log` | `ipconfig` / `wmic` / `tasklist` | `ip_route` / `ss` / `dns` |
| `exec.run/spawn` (fork-and-run) | | |

### exec: run programs in a child process (fork-and-run, all platforms)

`exec.run(program, args, {env, cwd, timeoutSeconds})` executes a program in a
**separate child process** and waits for the result (Linux = fork+exec,
Windows = CreateProcessW); `exec.spawn(program, args, {env, cwd})` starts a
detached background process and returns its PID immediately. The child is
isolated from the agent: a crash or hang (auto-killed on timeout) cannot take
the agent down. Returns a JSON string:

```js
var r = exec.run("/bin/sh", ["-c", "echo $MY_VAR"], {
    env: { "MY_VAR": "value" }, cwd: "/tmp", timeoutSeconds: 30
});
// {"success":true,"exitCode":0,"stdout":"value\n","stderr":"","timedOut":false}

var p = exec.spawn("notepad.exe", [], {});   // {"success":true,"pid":4321}
```

A missing program returns `{"success":false,"error":"..."}` instead of
throwing; the same semantics are available as the `forkexec` cloud module
(MCP `execute_process`/`spawn_process`).

### native (cdylib)

`module/<platform>/xxx.dll|so` must export (`libra-load` ABI):

```rust
#[no_mangle] pub extern "C" fn module_name() -> *const u8 { concat!("xxx\0").as_ptr() }
#[no_mangle] pub unsafe extern "system" fn module_main(
    input: *const u8, input_len: usize, output: *mut u8, output_cap: usize) -> usize { … }
```

`module_name` must match `meta.json`'s `module.name` (self-check); input/output are UTF-8 JSON.

## Frontend Integration

`page/index.tsx` is source-distributed (tsx cannot compile at runtime): place it at `src/webapp/src/plugins/<pluginId>/index.tsx` and rebuild the frontend (`import.meta.glob` collects it at build time). Use the host API:

```tsx
import { usePluginHost } from '../../hooks/usePluginHost';
export default function MyPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const run = async () => {
    const res = await dispatchTask('com.example.xxx', 'collect', { capability: 'whoami' });
    console.log(res.result);
  };
  // any HeroUI component works (Button/Card/Table/Accordion/Modal/Tabs…)
}
```

`usePluginHost()`: `selectedAgent` / `selectAgent` / `dispatchTask(pluginId, action, args?, agentId?)` / `subscribeOutput(cb, action?)` / `lastOutput`.

## Plugin Market (Libra-Plugins)

- A standalone repo holds `*.zip` + `index.json` (`pluginId/name/version/author/description/file/size`); CI (GitHub Actions) rebuilds the index whenever a zip changes
- Console「Plugin Market」fetches index.json straight from GitHub raw (localStorage cache **1 hour**); one-click install = download zip → import
- `index.json` is generated by `build-index.ps1`; **do not edit by hand**

## Install Methods

| Method | Notes |
| --- | --- |
| **Upload** | pick a zip, import & enable |
| **Import from Git** | paste a Git URL; the server `git clone`s it (repo name becomes pluginId; meta.json required at repo root) |
| **Plugin Market** | one-click from the Libra-Plugins index |

## Gotchas

1. `meta.json` must be at the zip **root**, camelCase keys (`pluginId`/`argsSchema`)
2. `pluginId` allows only `[A-Za-z0-9.\-_]`; filenames/assets are whitelisted
3. Script channel updates take effect after re-import/restart (Agent downloads on demand); native channel needs recompiling + **Agent restart to drop the in-memory cache**, and if `build-output` was rebuilt, re-stage the plugin dll into `build-output/modules/<platform>/`
4. `argsSchema` only drives the form & light validation — real validation lives in the script/module
5. Serialize non-ASCII/multiline returns as JSON instead of hand-building strings

## Sample Plugins

| Plugin | Purpose |
| --- | --- |
| `com.example.plugin-sdk` | living-docs page + full multi-platform module (tutorial) |
| `com.libra.qqkey` | probe local QQ ClientKey (local port → jump exchange) + QQ Zone link; auto-loads list+avatars, plaintext keys |
| `com.libra.aitoken` | collect AI agent tool API keys; auto-scans on entry, grouped by vendor |