# HTML Plugin Page SDK

Plugin pages are **pure HTML+JS+CSS** — no compilation, no React/HeroUI dependency. The console
renders `page/index.html` into an **injected iframe (srcdoc)**: the console first fetches the page
HTML, injects `<base>` + SDK into `<head>`, then renders — **plugin pages need not reference any
SDK files**, and `window.Libra` is directly available.

## 1. Page Structure

```
page/
├── index.html    # 页面(引用 index.css / index.js;SDK 已由宿主注入)
├── index.js      # 逻辑
└── index.css     # 样式(完全自包含,控制台不注入任何类名)
```

```html
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

> No `<script src="_bridge.js">` is needed inside the page (the host has already injected it);
> keeping one is still compatible (the bridge script carries a de-dup marker and skips the second load).

## 2. SDK — `window.Libra`

| Member | Type | Description |
|---|---|---|
| `pluginId` | `string` | Current plugin id (injected by the host) |
| `getApiOrigin()` | `() => string` | Backend origin (injected by the host; use it to build cross-origin URLs) |
| `usePluginHost()` | `() => Host` | Host capabilities (selected agent / task dispatch / WS push) |
| `api` | `{ get, post, put, delete }` | JWT-bearing backend API calls (proxied by the host; the plugin never reads the token) |

The legacy name `window.LibraPluginHost` is kept as an alias for compatibility with old plugin pages.

### `usePluginHost()` return value

```js
const host = Libra.usePluginHost();

host.selectedAgent      // { id, hostname, ipAddress, ... } | null —— 当前选中设备
host.lastOutput         // { data, agentId, action, ts } | null —— 最近一条推送
host.selectAgent(id)    // Promise —— 切换选中设备(与控制台联动)
host.dispatchTask(pluginId?, action, args?, agentId?)  // Promise<{pluginId, action, result}>
                        //   pluginId 可省略(默认当前插件);result 可能是对象或 JSON 字符串
host.subscribeOutput(cb, action?)  // 订阅 WS 实时推送;返回退订函数
                        //   cb(output): output = { data, agentId, action, ts }
```

### `api` calls

```js
const list = await Libra.api.get('/plugins/manager');          // 插件列表
const rec  = await Libra.api.post('/plugin/<id>/<fn>', {...}); // 服务端脚本
const res  = await Libra.api.put('/plugins/manager/<id>', { meta });
await Libra.api.delete('/plugins/manager/<id>');
```

On failure the Promise rejects with an `Error`. Paths do **not** include the `/api` prefix
(the host prepends it).

### Static assets

Assets inside the plugin package (icons / images / markdown) are fetched directly. The iframe is a
sandboxed opaque origin, so cross-origin fetch requires the server to allow it (the backend
page/assets endpoints already return `Access-Control-Allow-Origin: *`):

```js
const base = Libra.getApiOrigin();   // http://127.0.0.1:5270
const md = await fetch(`${base}/api/plugins/${Libra.pluginId}/assets/docs/01-overview.md`).then(r => r.text());
// 注意:必须用 Libra.getApiOrigin() 拼绝对地址;srcdoc 下 location.origin 不是后端
```

## 3. Conventions & Restrictions

- **No external dependencies**: no CDN references, no npm package imports; all UI uses native DOM + its own CSS.
- **Self-contained styles**: `index.css` fully manages its own styles; host Tailwind/HeroUI classes do not exist inside the iframe.
- **No access to the parent window's DOM**: interact only through the bridge SDK; the iframe sandbox has no `allow-same-origin`, so plugins cannot read the parent window's localStorage (JWT safety).
- Dark / light theme is handled by the plugin itself (you may use `prefers-color-scheme`).
- Packaging: `node pack.mjs` (zero dependencies, HTML packed as-is); after installing to the server runtime directory and refreshing the console, the change takes effect — identical in dev / preview, no frontend rebuild needed.

## 4. Minimal Example

```js
// page/index.js —— SDK 已注入,直接使用 window.Libra
const host = Libra.usePluginHost();

async function run() {
  if (!host.selectedAgent) { app.textContent = '请先在控制台顶部选择设备'; return; }
  const res = await host.dispatchTask('showcase', { capability: 'whoami' });
  app.textContent = typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2);
}
run();
```
