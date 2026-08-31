# Plugin System

> This document is an **architecture overview** of the plugin system — not the plugins themselves.
> Installable plugin sources and the plugin market repository live in
> [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins) (a separate repository; this
> repository does not track its checkout).

## 1. Repository Boundaries (Hard Constraints)

| Path | Contents | Tracked in repo |
|---|---|---|
| `Libra-Plugins/` (separate repository) | Plugin source: `meta.json` + `module/` + `service/` + `page/` + `assets/` | Separate git repository |
| `src/plugins/` | Server **runtime install directory** (zip import / extraction target) | ❌ gitignored |
| `src/service/plugins-service/` | Server-side script development fallback directory | ❌ gitignored |
| `src/webapp/src/plugins/` | Console runtime loader (registry / loader / icons) — contains no plugin pages | ✅ |

**Installed plugin directories and their related files must never enter the git repository.**
Plugins can only be landed into the runtime directory via zip import or the install script; any
addition, deletion, or modification of plugin source happens in the Libra-Plugins repository.

## 2. Frontend Rendering Architecture (runtime-loaded, identical in dev / preview)

Plugin pages are **pure HTML+JS+CSS** (no TSX, no compilation, no React/HeroUI dependency).
The console does not compile plugin pages into its bundle:

1. `GET /api/plugins/manager/manifests` (enabled manifest, backend) →
2. For each plugin with an `entry`, `GET /api/plugins/{id}/page/manifest.json` (backend) →
3. The console fetches the plugin's `page/index.html`, injects `<base>` + SDK into `<head>`,
   and renders it in a **sandbox iframe (srcdoc)**. Plugin pages need not reference any SDK
   files — `window.Libra` is directly available, and host capabilities are obtained via
   postMessage RPC.

**Effect**: adding / updating a plugin only requires new files to appear on the server — neither
`npm run dev` nor `npm run preview` needs a console rebuild; after importing a plugin, refreshing
the page applies the change. Page asset endpoints are anonymously readable, like `assets/`
(pages contain no sensitive data; all data flows through token-bearing business APIs).

## 3. Plugin Pages & the Bridge SDK

- **Page shape**: `page/index.html` + `page/index.js` + `page/index.css`, zero dependencies,
  fully self-contained styles (host Tailwind/HeroUI classes do not exist inside the iframe).
- **Bridge SDK (injected)**: `window.Libra` — `pluginId` / `getApiOrigin()` /
  `usePluginHost()` (selectedAgent, selectAgent, dispatchTask, subscribeOutput) /
  `api.get/post/put/delete` (JWT-bearing backend calls).
  Full contract: [`html-plugin-sdk.md`](html-plugin-sdk.md).
- **Packaging**: `node pack.mjs` (zero dependencies, HTML packed as-is).

## 4. Development / Installation Flow

```bash
# 插件仓库内:打包
node pack.mjs          # → dist/<pluginId>-<version>.zip

# 控制台导入(Web UI 插件管理页,或)
# curl -F file=@plugin.zip http://127.0.0.1:5270/api/plugins/manager/import

# 开发环境一键安装全部内置插件(从本地 Libra-Plugins checkout 复制,无编译)
node scripts/install-builtin-plugins.mjs
```

After installation, **refresh the console page** to see the plugin entry — no frontend rebuild needed.

## 5. Related Documents

- HTML plugin page SDK contract: [`html-plugin-sdk.md`](html-plugin-sdk.md)
- Plugin development template: `Libra-Plugin-Template/` (separate repository checkout, includes meta / agent / service / page / pack)
- Market index: `Libra-Plugins/index.json` + `build-index.ps1`
