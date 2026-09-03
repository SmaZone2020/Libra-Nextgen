# Libra-Nextgen Deployment Manual

> **Correspondence**: English version of [`../deployment.md`](../deployment.md) (Chinese deployment manual). Content follows the real production implementation.

> **Docker is recommended for production / self-service deployment (§6.2)**: one command brings up
> MongoDB + Server + nginx, and win x64 / linux-x64 agents can be built online in-container — the host
> needs no .NET / Node / Rust / MongoDB. Bare-metal deployment is covered in §3–§5, development in §0.

## 0. Development Environment Quick Start

> Full environment installation and startup steps are in [README Quick Start](../../README_en.md) (including download URLs and verification commands for each dependency).

**Dependencies**: MongoDB 7.0+ (start first) · .NET SDK 10 · Node.js 20+ (Rust 1.80+ only needed to build payloads online).

```bash
# 1. Server (http://localhost:5270)
cd src/LibraNextgen.Server && dotnet run
# 2. Console (http://localhost:5173; /setup on first visit creates the admin)
cd src/console && npm install && npm run dev
```

## 1. Architecture Overview

```
┌─────────────┐   HTTPS/HTTP   ┌──────────────┐        ┌────────────┐
│ Console     │ ─────────────▶ │  nginx       │ ─────▶ │ Libra-Server│
│ (React SPA) │  /api /ws/console│  reverse     │        │ (ASP.NET)  │
└─────────────┘                │  proxy (TLS) │        └─────┬──────┘
                              └──────────────┘               │
              ┌──────────────────────────────────────────────┤
              │                                              │
   ┌──────────▼─────────┐                          ┌─────────▼─────────┐
   │ MongoDB            │                          │ build-output/     │
   │ libra_nextgen DB   │                          │ modules/artifacts/│
   └────────────────────┘                          │ keys              │
                                                   └───────────────────┘
```

**Two channels**:

- **Agent ↔ Server** (beacon, no WebSocket): the Agent polls over HTTPS at fixed intervals (registration / heartbeat / result reporting); task events are pushed over an SSE long connection. Everything is disguised as normal API calls:
  - `POST /v1/chat/completions` — AI channel: registration/heartbeat/results/module downloads (encrypted)
  - `GET  /api/v1/models/events` — SSE task event stream (long connection, 30s keepalive)
  - `GET  /api/v1/models/{id}`    — loader download of core.bin (one-time credential)
  - `POST /api/v1/session`        — agent registration (OAuth-style hybrid encryption)

- **Console ↔ Server** (REST + WebSocket): the console uses REST management APIs; realtime state/pushes go over `WS /ws/console?token=…`. nginx does not need WebSocket upgrade for the Agent (zero WS on the agent side), but the console's `/ws/console` needs upgrade support (see §4).

## 2. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LIBRA_SERVER_KEY` | Required for public deployments | Path to the server RSA private key PEM file (deployment-level; used for agent registration/key negotiation). **Must be persisted** — auto-generated as `server-rsa.key` on first start; restarting or changing the key forces all online agents to re-register (they self-heal, but disconnect once). Recommend a fixed path after generation |
| `LIBRA_BUILDS_DIR` | Required for public deployments | Absolute path to the build-artifacts directory (agent executables, module dlls, core.bin). **Shared by the Builder and module serving** (both read it; when unset, falls back to a relative path under the app base dir, which breaks in published/container deployments — always set it explicitly). Container deployment defaults to `/build-output` |
| `LIBRA_AGENT_RS_DIR` | Optional | Path to the agent-rs source workspace (used by the Builder). Falls back to the repo dev layout when unset; container deployment defaults to `/agent-rs` (mount a custom source tree to override) |
| `Beacon__Secret` | Optional | Shared secret (legacy pre-session encryption fallback). Not needed by the new protocol (hybrid encryption); when unset, legacy encrypted registration is rejected |
| `MongoDB__ConnectionString` | Default | Mongo connection string, default `mongodb://localhost:27017` |
| `ASPNETCORE_ENVIRONMENT` | Set `Production` in production | Controls the exception detail page (production returns only unified JSON errors) |

## 3. Database (MongoDB)

- Database name `libra_nextgen` (overridable via `MongoDB__DatabaseName`)
- **Auth is mandatory in production**: create a dedicated user, connection string `mongodb://user:pass@host:27017/libra_nextgen?authSource=admin`
- Collections: `agents` / `tasks` / `users` / `session_keys` / `session_tokens` / `build_lists` / `plugins` / `audit_logs` etc. (indexes are auto-created at startup)

## 4. nginx Configuration (public)

```nginx
server {
    listen 443 ssl;
    server_name ai.yuxiit.cn;

    # TLS (mandatory): plaintext HTTP directly exposes all masqueraded paths/headers
    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Large request bodies: module download results / large task results (recommend ≥30MB)
    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:5270;
        proxy_http_version 1.1;
        # SSE long connections (agent event stream): read/send timeout must exceed
        # the keepalive interval (30s); 120s recommended
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;               # buffering must be off for SSE
        # Console realtime push /ws/console needs WebSocket upgrade
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# Optional: HTTP → HTTPS redirect
server {
    listen 80;
    server_name ai.yuxiit.cn;
    return 301 https://$host$request_uri;
}
```

## 5. Key Management

| Key | Location | Notes |
|---|---|---|
| Server RSA (agent hybrid encryption) | file specified by `LIBRA_SERVER_KEY` | private key permissions `600`; loss = all agents must be rebuilt & redeployed |
| JWT RSA (console login) | `%APPDATA%/Libra-Nextgen/jwt-rsa-key.bin` (Windows DPAPI) | generated on first start of the deployment machine; back up this file |
| core.bin AES key | `build-output/{buildId}/core.key` | generated per build, kept with the build dir |
| Mongo credentials | connection string | enable auth in production |

## 6. Build & Upgrade

1. Deploy a new server: replace binaries + restart (agent sessions auto-recover via persisted `session_keys`/`session_tokens`)
2. Rebuild agents: Builder page 「Generate」(core uses prebuilt in seconds + modules compiled on demand)
3. Module changes: Builder page 「Module Management」 → check → 「Build Modules」
4. Frontend: build the SPA artifact and deploy to a static directory (or same-origin reverse proxy)
5. Plugin pages: **no frontend rebuild needed** — plugins imported as zip are served by the server at runtime (`/api/plugins/{id}/page/**`); refresh the console to take effect

> Version compatibility note: loader downloads carry a one-time credential (downloadToken); old loaders requesting without a credential are rejected with 401 — after upgrading, rebuild both the loader and the agent.

## 6.1 Cloud Modules & Plugin Staging

Build artifact layout (`LIBRA_BUILDS_DIR`):

```
build-output/
├── agent.exe / agent etc. payload artifacts
└── modules/{x64,linux-x64}/*.dll|.so   # Agent cloud modules (on-demand download source)
```

- Built-in modules: `shell`, `recon`, `creds`, `files`, `powershell`, `proxy`, `script` (QuickJS JS engine), `token`. The Agent downloads them on demand when a task family is first used — **in-memory loading, nothing touches disk**.
- **Plugin native-module staging flow**: on plugin import/enable, `PluginService.StageModules` copies `module/<platform>/*.dll|.so` from the zip into `build-output/modules/<platform>/`; the Agent downloads by `module.name` when executing a plugin action.
- ⚠️ Rebuilding/recreating `build-output` may wipe plugin dlls, causing `module download failed: 404` on plugin actions — disable then re-enable on the plugin management page to re-stage.
- The Agent's `ModuleManager` keeps an in-memory cache of loaded modules: after updating a native module you must **restart the Agent** for it to re-download.

## 6.2 Docker Deployment (recommended, linux/amd64)

For self-service deployments: one command brings up the whole stack (MongoDB + Server + nginx), and the
image ships a Rust/zig toolchain, so **win x64 / win x86 (GNU ABI, cross-compiled) and linux-x64 agents
can be built online inside the container** — no .NET / Node / Rust / MongoDB install on the host.
The server image is linux/amd64 only.

### Layout (`deploy/`)

| File | Purpose |
|---|---|
| `Dockerfile` | Three-stage build: console SPA → dotnet publish → runtime image (rustup + zig + cargo-zigbuild) |
| `docker-compose.yml` | mongo:7 + server + nginx; five named volumes for persistence |
| `.env.example` | Environment template (copy to `.env` and fill in) |
| `nginx/console.conf` | nginx site config (SPA static + segmented API/SSE/WS/MCP proxy; includes a TLS sample) |
| `docker/entrypoint.sh` | Container entrypoint: prepare persistent dirs, then start the server |

### Quick start

Prerequisites: Docker Engine 24+ and Compose v2.

```bash
cd deploy
cp .env.example .env
# edit .env: at least set VITE_API_BASE (the public origin the console is served from, e.g. https://c2.example.com)
docker compose up -d --build
```

Open the `VITE_API_BASE` URL; first visit to `/setup` creates the admin.

**Single-port note**: `VITE_API_BASE` is baked into the frontend at image build time; all console
API/SSE/WS calls target that origin through nginx :443, and agent/beacon traffic also enters via 443.
Changing the domain/port requires rebuilding with `docker compose up -d --build`.

### Persistence (five named volumes)

| Volume | Mount | Contents |
|---|---|---|
| `mongo-data` | `/data/db` | All MongoDB data (incl. audit logs) |
| `libra-builds` | `/build-output` | Build artifacts, modules, `artifacts/`, shared cargo cache (`target-shared`) |
| `libra-config` | `/root/.config/Libra-Nextgen` | JWT RSA key + listener settings |
| `libra-secrets` | `/secrets` | Server RSA private key (auto-generated on first start) |
| `console-dist` | `/srv/console-live` → `/usr/share/nginx/html` | Console SPA (re-synced from the image by the entrypoint on every start; safe to delete, rebuilt from the image) |

Removing containers does not touch volumes; backup/migration = copy the four volumes plus `.env`.

### TLS

1. Put `fullchain.pem` / `privkey.pem` under `deploy/certs/`
2. Uncomment the 443 server block in `nginx/console.conf` (or turn the 80 server into a 301 redirect)
3. Set `VITE_API_BASE` to an https:// origin in `.env` and rebuild the image

### Building agents online

- Builder platforms: win x64 / win x86 / linux-x64 all build directly; win payloads are **GNU ABI**
  (zig cross-compilation), functionally equivalent to and co-existing with MSVC builds from a Windows dev box.
- The first build of a platform compiles on the spot (the container needs outbound access to crates.io;
  deps are pre-fetched into the image layer and cached in the volume); `artifacts/{platform}/core.bin`
  hits make subsequent builds take seconds.

### Upgrades

- Local build: `git pull && docker compose up -d --build`
- Image release: GitHub Actions pushes `ghcr.io/<owner>/<repo>` (tags `latest` / `sha-<id>` / `v<tag>`);
  deploy hosts run `docker compose pull` then `up -d`.

### Migrating from bare-metal / Windows deployments

1. MongoDB: `mongodump` export → `mongorestore` inside the container (or copy the `mongo-data` volume)
2. Build artifacts: copy the old `build-output/` into the `libra-builds` volume
3. Keys: the private key file pointed to by `LIBRA_SERVER_KEY`, and the `%APPDATA%/Libra-Nextgen` dir (JWT key)
4. Fresh deployments auto-generate all keys on first start

### Known limitations (v1)

- Server image is linux/amd64 only
- HTTP by default; enable TLS as above; MongoDB auth is off by default (enable in production, see §3)
- Container runs as root and the image is unsigned (OpSec hardening is planned for later versions)

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Agent re-registers repeatedly | server RSA key doesn't match the public key injected at build time | confirm `LIBRA_SERVER_KEY` points to the same key used at build; rebuild the agent |
| Module download 404 | `LIBRA_BUILDS_DIR` doesn't point to the module dir / module not built | check the env var; Builder 「Build Modules」 |
| SSE disconnects within seconds | nginx `proxy_read_timeout` below the 30s keepalive | raise to 120s |
| Tasks don't respond | agent offline / SSE not connected | check agent logs (debug build) and Dashboard online status |
| Loader download 401 | loader version too old (no downloadToken) | rebuild the loader (the credential mechanism is enforced from this version) |
| Console 500 without details | production global exception handling (correct behavior) | check server logs (LogError includes Path/Method) |
| win-x64 payload build fails in container | zig / cargo-zigbuild missing or version pairing broken | run `zig version` inside the container; adjust `ZIG_VERSION` and rebuild the image |
| Login sessions lost after container restart | `libra-config` volume missing or wiped | confirm the compose volume exists; the JWT key persists at `/root/.config/Libra-Nextgen` |
