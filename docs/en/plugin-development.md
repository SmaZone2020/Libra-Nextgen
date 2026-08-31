# Plugin Development Tutorial

> **Correspondence**: English version of [`../zh/plugin-development.md`](../zh/plugin-development.md) (Chinese plugin development tutorial). Content follows the real production implementation.

Plugins are delivered as a **zip package** and imported/enabled from the Console **plugin management page**. One plugin = one zip; you may implement one layer or all three. **The frontend page is pure HTML+JS+CSS — no compilation, no console rebuild required.**

## The Three Layers of a Plugin

| Layer | Location (in zip) | Purpose | When needed |
| --- | --- | --- | --- |
| **Agent module** | `module/` | run collection/operations on the target machine | need Agent capabilities |
| **Frontend page** | `page/` | UI inside the Console (HTML+JS+CSS) | need custom display/interaction |
| **Server script** | `service/` | custom server-side logic (C# script, parsed & executed by Roslyn) | need to send network requests / compute signatures / read files from the package on the server |

## zip Structure

```
plugin.zip
├── meta.json          # plugin contract (required, at zip root)
├── module/            # Agent-side modules
│   ├── xxx.js            #   script channel (JavaScript/QuickJS, no compilation, recommended)
│   └── x64/xxx.dll    #   native channel (per-platform dirs: x64/linux-x64)
├── page/              # frontend page (pure HTML+JS+CSS, loaded at runtime)
│   ├── index.html
│   ├── index.js
│   └── index.css
├── service/           # server C# scripts (main.cs + utility classes, multi-file concatenated & compiled)
└── assets/            # static assets (served anonymously via /api/plugins/<pluginId>/assets/<file>)
```

## meta.json Contract

```jsonc
{
  "schemaVersion": 1,
  "pluginId": "com.example.xxx",   // letters/digits/. /- /_ only; reverse-DNS recommended
  "name": "插件名",
  "version": "1.0.0",
  "author": "libra",
  "description": "一句话描述",
  "entry": {
    "route": "xxx",          // page route /plugins/xxx
    "label": "nav.xxx",      // i18n key
    "icon": "Puzzle",        // icon name (console whitelist mapping, see docs/plugins/README.md)
    "apiRoot": "/api/plugins/com.example.xxx"
  },
  "i18n": { "zh": { "nav.xxx": "插件名" }, "en": { "nav.xxx": "Plugin" } },
  "actions": [
    {
      "action": "collect",          // action name (used by the page's dispatchTask)
      "label": "采集",              // button text
      "method": "POST",
      "argsSchema": {               // argument JSON Schema
        "type": "object",
        "properties": { "capability": { "type": "string", "title": "能力名" } },
        "required": []
      },
      "module": {
        "kind": "script",           // script=JavaScript(QuickJS) / native=cdylib
        "name": "xxx",              // .js file stem or .dll/.so file name
        "op": "collect",            // injected into the module input JSON as op
        "entry": "main"             // script entry function (default main)
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

The sandbox is a bare QuickJS runtime (no `fetch`/`require`/`console`/`eval`; use `log()` for logging). Branch per-platform **at runtime** with `__platform()` (returns `"windows" | "linux" | "macos" | "unknown"`); platform-specific functions are registered only on their platform. Platform API quick reference:

| Common | Windows | Linux/macOS |
| --- | --- | --- |
| `fs.read/write/list/exists` | `cmd` / `powershell` | `shell` / `bash` |
| `proc.list()/kill(pid)` | `reg_query/set/delete` | `uname` / `hostname` |
| `env.get` / `whoami` / `log` | `ipconfig` / `wmic` / `tasklist` | `ip_route` / `ss` / `dns` |
| `exec.run/spawn` (fork-and-run) | | |

`exec.run(program, args, {env, cwd, timeoutSeconds})` executes a program in an independent child process and waits for the result (Linux = fork+exec, Windows = CreateProcessW); `exec.spawn(...)` starts a detached background process and returns the PID. The child process is isolated from the Agent — a crash/timeout cannot affect the Agent itself:

```js
var r = exec.run("/bin/sh", ["-c", "echo $MY_VAR"], { env: { "MY_VAR": "value" }, cwd: "/tmp", timeoutSeconds: 30 });
// {"success":true,"exitCode":0,"stdout":"value\n","stderr":"","timedOut":false}
```

### native (cdylib)

`module/<platform>/xxx.dll|so` exports (`libra-load` ABI):

```rust
#[no_mangle] pub extern "C" fn module_name() -> *const u8 { concat!("xxx\0").as_ptr() }
#[no_mangle] pub unsafe extern "system" fn module_main(
    input: *const u8, input_len: usize, output: *mut u8, output_cap: usize) -> usize { … }
```

`module_name` must match `meta.json`'s `module.name` (self-checked); input and output are UTF-8 JSON.

## Server Scripts (service/)

`service/*.cs` ships in the zip and is parsed & executed by the server's `ServerScriptService` via Roslyn (multiple files are concatenated in filename order and compiled; results are cached per plugin and invalidated automatically when files change). The entry file returns a `Dictionary<string, Func<object, object>>` function table, driven by `POST /api/plugin/<pluginId>/<fn>`; any JSON body becomes the script function's `p` (dynamic):

```csharp
using System;
using System.Collections.Generic;

public static class Entry
{
    public static object Echo(dynamic p) => new { ok = true, data = new { text = (string)p?.text } };
    public static object Now(dynamic p) => new { ok = true, data = DateTime.Now.ToString((string)p?.format ?? "yyyy-MM-dd HH:mm:ss") };
}

// The file must end by returning the function table:
return new Dictionary<string, Func<object, object>> {
    ["echo"] = Entry.Echo,
    ["now"] = Entry.Now,
};
```

- Referenceable libraries: `System.Net.Http` / `System.Text.Json` / `Linq`, etc. (see `ServerScriptService`'s ScriptOptions)
- Synchronous signature; use `.GetAwaiter().GetResult()` inside to wait on async work (e.g. HttpClient)
- Exceptions uniformly return `{ ok: false, error }`; the host caches the compiled result per plugin; the `file` function can read files inside the package

## Frontend Page (page/, pure HTML+JS+CSS)

The page is **loaded at runtime — no compilation, no console rebuild**. The console fetches `page/index.html`, injects `<base>` + SDK into `<head>`, and renders it in a sandbox iframe; **the page directly uses the injected `window.Libra`** — no SDK file needs to be referenced:

```html
<!-- page/index.html -->
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="index.css">
</head>
<body>
  <div id="app"></div>
  <script src="index.js"></script>
</body>
</html>
```

```js
// page/index.js — the SDK is already injected; use window.Libra directly
const host = Libra.usePluginHost();

async function run() {
  if (!host.selectedAgent) { app.textContent = '请先在控制台顶部选择设备'; return; }
  const res = await host.dispatchTask('collect', { capability: 'whoami' }); // pluginId can be omitted
  app.textContent = typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2);
}
run();
```

SDK capabilities:

| Member | Description |
| --- | --- |
| `Libra.pluginId` | current plugin id |
| `Libra.getApiOrigin()` | backend origin (use it to build absolute URLs for cross-origin fetches) |
| `Libra.usePluginHost()` | `selectedAgent` / `selectAgent` / `dispatchTask(pluginId?, action, args?, agentId?)` / `subscribeOutput(cb, action?)` / `lastOutput` |
| `Libra.api.get/post/put/delete(path, body?)` | backend API calls with JWT (path without the `/api` prefix) |

The full contract and conventions (zero external dependencies / self-contained CSS / light & dark themes) are in [HTML Plugin Page SDK](../plugins/html-plugin-sdk.md).

## Plugin Market (Libra-Plugins)

- A standalone repository holds plugin sources and `*.zip` + `index.json` (CI rebuilds the index automatically whenever a zip changes)
- The Console's 「Plugin Market」 fetches `index.json` directly from GitHub raw (localStorage cache **1 hour**); one-click install = download zip → go through the import flow
- `index.json` is generated by `build-index.ps1` — **do not edit by hand**

## Import Methods

| Method | Description |
| --- | --- |
| **Upload plugin** | pick a zip, import and enable |
| **Import from Git** | paste a Git link; the server `git clone`s it into the plugin dir, **repo name becomes pluginId** (meta.json required at repo root) |
| **Plugin Market** | one-click install from the Libra-Plugins index |

## Development Notes

1. `meta.json` must be at the zip **root**, camelCase keys (`pluginId`/`argsSchema`)
2. `pluginId` allows only `[A-Za-z0-9.\-_]`; filenames/assets are validated against a whitelist
3. The script channel picks up script changes directly (the Agent downloads on demand after re-import/restart); the native channel needs recompiling + **Agent restart to drop the in-memory cache**, and if `build-output` was rebuilt you must re-stage the plugin dll (disable then re-enable on the plugin management page to re-stage)
4. `argsSchema` only drives the form and light validation — real input validation happens in the script/module
5. Serialize non-ASCII / multiline return values as JSON instead of hand-building strings
6. **Repository boundary**: installed plugin dirs (`src/plugins` etc.) are runtime state and are **not committed to git**; plugin sources are maintained in the standalone Libra-Plugins repository

## Sample Plugins

| Plugin | Description |
| --- | --- |
| `com.example.plugin-sdk` | living-docs tutorial page (5 tabs) + full multi-platform module + server-script walkthrough |
| `com.libra.qqkey` | probe the local QQ ClientKey, auto-load lists+avatars, business operations (moments/profile/groups, etc.) |
| `com.libra.aitoken` | collect local AI agent tool API keys; auto-scans on entry, grouped by vendor |
| `com.libra.av-list` | antivirus detection (product identification/matching processes/platform) |
| `com.libra.browser-stealer` | browser passwords/history: paged loading, search, CSV export |
| `com.libra.wechat-file` | WeChat account dirs & monthly file dirs browsing, download |
