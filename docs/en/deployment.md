# Deployment & Building

## Requirements

| Component | Requirement |
| --- | --- |
| Rust | 1.80+ |
| .NET SDK | 10 (service + common) |
| Node.js | 20+ (webapp) |
| MongoDB | 7.0+ |
| zig (optional) | cross-builds; auto-detected by the server |

## Local Startup

```bash
# 1. Server (http://localhost:5270)
cd src/service
dotnet run

# 2. Console (http://localhost:5173; create admin on first /setup visit)
cd src/webapp
npm install
npm run dev
```

The Console reaches the API via `VITE_API_BASE` (default `http://127.0.0.1:5270`).

## Building Payloads with the Builder

Console **Builder** builds Agent payloads online. Outputs live in `src/build-output/`:

```
build-output/
├── agent.exe / agent ...
└── modules/{x64,x86,linux-x64}/*.dll|.so     # cloud modules (Agent download source)
```

- **Win x64 / x86**: MSVC native (VS Build Tools + Rust MSVC toolchain)
- **Linux x64**: native (default rustc toolchain)
- **Cross-builds**: the server auto-detects **zig + cargo-zigbuild** and invokes it; a clear error is shown when missing

```bash
cargo install cargo-zigbuild
# download zig (https://ziglang.org/download) and add it to PATH
```

> Plain `cargo build --release` only produces host-platform payloads; use Builder or `cargo build --target ...` for cross-builds.

## Cloud Modules

Built-in modules (`build-output/modules/<platform>/`): `shell`, `recon`, `creds`, `files`, `powershell`, `proxy`, `script` (Rhai engine). The Agent downloads them on first use and executes **in memory (zero disk)**.

**Staging plugin (native) modules**:
1. On plugin import/enable, `PluginService.StageModules` copies zip `module/<platform>/*.dll|.so` into `build-output/modules/<platform>/`
2. When the Agent runs a plugin action, it downloads the dll by `module.name`

> ⚠️ **After rebuilding/recreating `build-output`, plugin dlls may be wiped** — plugin actions then fail with `module download failed: 404`. Two fixes:
> - In the plugin manager, **disable then re-enable** the plugin (re-triggers staging)
> - Or manually copy `examples/<plugin>/module/x64/*.dll` back into `build-output/modules/x64/`

## MongoDB / Config Notes

- Server config: `src/service/appsettings*.json` (connection string, JWT key, listen address)
- Indexes are built on startup; `AuditLogs` are append-only (mandatory audit)
- Production: rotate the JWT key, listen on a non-loopback address, put a reverse proxy + TLS in front

## Plugin Repo (Libra-Plugins)

A separate (not nested) repo maintains the plugin market:
- `*.zip` at the root; **never hand-edit** `index.json`
- push zip changes to main; CI runs `build-index.ps1` to rebuild `index.json` and commits it
- Console market fetches from GitHub raw (`VITE_PLUGIN_MARKET_BASE` overrides the URL); 1h browser cache

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| plugin action `module download failed: 404` | plugin dll not staged: disable/re-enable the plugin, or copy the dll into `build-output/modules/<platform>/` |
| Agent stays offline | check Mongo, server port, heartbeat; the Agent re-registers after a Server restart |
| Builder cross-build fails | verify zig + cargo-zigbuild are installed and on PATH |
| Console network error | check `VITE_API_BASE`; https consoles need a same-origin/proxied API or CORS |