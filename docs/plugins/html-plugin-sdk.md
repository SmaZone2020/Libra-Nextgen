# HTML 插件页面 SDK

插件页面是**纯 HTML+JS+CSS**,不编译、不依赖 React/HeroUI。控制台把
`page/index.html` 渲染进**注入式 iframe**(srcdoc):控制台先拉取页面 HTML,
向 `<head>` 注入 `<base>` + SDK,再渲染——**插件页面无需引用任何 SDK 文件**,
`window.Libra` 直接可用。

## 1. 页面结构

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

> 页面内不需要 `<script src="_bridge.js">`(宿主已注入);如果保留了也兼容
> (桥脚本有防重标记,会跳过第二次加载)。

## 2. SDK —— `window.Libra`

| 成员 | 类型 | 说明 |
|---|---|---|
| `pluginId` | `string` | 当前插件 id(宿主注入) |
| `getApiOrigin()` | `() => string` | 后端 origin(宿主注入;跨源资源请用它拼接) |
| `usePluginHost()` | `() => Host` | 宿主能力(选中设备/任务下发/WS 推送) |
| `api` | `{ get, post, put, delete }` | 带 JWT 的后端 API 调用(宿主转发,插件读不到 token) |

旧名 `window.LibraPluginHost` 保留为别名,兼容旧插件页面。

### `usePluginHost()` 返回值

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

### `api` 调用

```js
const list = await Libra.api.get('/plugins/manager');          // 插件列表
const rec  = await Libra.api.post('/plugin/<id>/<fn>', {...}); // 服务端脚本
const res  = await Libra.api.put('/plugins/manager/<id>', { meta });
await Libra.api.delete('/plugins/manager/<id>');
```

失败时 Promise reject(`Error`)。路径**不含** `/api` 前缀(宿主拼接)。

### 静态资源

插件包内资源(图标/图片/markdown)直接 fetch。iframe 是 sandbox 后的 opaque
origin,跨源 fetch 需要服务器允许(后端 page/assets 端点已返回
`Access-Control-Allow-Origin: *`):

```js
const base = Libra.getApiOrigin();   // http://127.0.0.1:5270
const md = await fetch(`${base}/api/plugins/${Libra.pluginId}/assets/docs/01-overview.md`).then(r => r.text());
// 注意:必须用 Libra.getApiOrigin() 拼绝对地址;srcdoc 下 location.origin 不是后端
```

## 3. 约定与限制

- **无外部依赖**:不引 CDN、不 import npm 包;所有 UI 用原生 DOM + 自带 CSS。
- **样式自包含**:`index.css` 全量自管;宿主 Tailwind/HeroUI 类在 iframe 内不存在。
- **不访问父窗口 DOM**:只通过桥 SDK 交互;iframe sandbox 无 allow-same-origin,
  插件无法读取父窗口 localStorage(JWT 安全)。
- 深色/浅色由插件自行处理(可用 `prefers-color-scheme`)。
- 打包:`node pack.mjs`(零依赖,HTML 原样打包);安装到服务器运行时目录后
  刷新控制台即生效,dev / preview 一致,无需重建前端。

## 4. 最小示例

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
