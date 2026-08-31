# HTML 插件页面 SDK

插件页面是**纯 HTML+JS+CSS**,不编译、不依赖 React/HeroUI。控制台把
`page/index.html` 加载进 iframe(`/api/plugins/<id>/page/index.html`),插件通过
桥 SDK 与宿主通信。

## 1. 页面结构

```
page/
├── index.html    # 页面(引用 index.css / index.js / _bridge.js)
├── index.js      # 逻辑
└── index.css     # 样式(完全自包含,控制台不注入任何类名)
```

`index.html` 开头引入桥:

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
  <script src="_bridge.js"></script>   <!-- 必须先于 index.js -->
  <script src="index.js"></script>
</body>
</html>
```

## 2. 桥 SDK —— `window.LibraPluginHost`

| 成员 | 类型 | 说明 |
|---|---|---|
| `pluginId` | `string` | 当前插件 id(桥从 URL 自动解析) |
| `getApiOrigin()` | `() => string` | 后端 origin(iframe 与后端同源,`location.origin` 即可) |
| `usePluginHost()` | `() => Host` | 宿主能力(选中设备/任务下发/WS 推送) |
| `api` | `{ get, post, put, delete }` | 带 JWT 的后端 API 调用(桥转发,插件读不到 token) |

### `usePluginHost()` 返回值

```js
const host = LibraPluginHost.usePluginHost();

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
const list = await LibraPluginHost.api.get('/plugins/manager');          // 插件列表
const rec  = await LibraPluginHost.api.post('/plugin/<id>/<fn>', {...}); // 服务端脚本
const res  = await LibraPluginHost.api.put('/plugins/manager/<id>', { meta });
await LibraPluginHost.api.delete('/plugins/manager/<id>');
```

失败时 Promise reject(`Error`)。路径**不含** `/api` 前缀(宿主拼接)。

### 静态资源

插件包内资源(图标/图片/markdown)直接 fetch,iframe 与后端同源:

```js
const md = await fetch(`/api/plugins/${LibraPluginHost.pluginId}/assets/docs/01-overview.md`).then(r => r.text());
```

## 3. 约定与限制

- **无外部依赖**:不引 CDN、不 import npm 包;所有 UI 用原生 DOM + 自带 CSS。
- **样式自包含**:`index.css` 全量自管;控制台(宿主)的 Tailwind/HeroUI 类在
  iframe 内**不存在**,不要使用。
- **不访问父窗口 DOM**:只通过桥 SDK 交互。
- 深色/浅色由插件自行处理(可用 `prefers-color-scheme`)。
- 打包:`node pack.mjs`(零依赖,HTML 原样打包);安装到服务器运行时目录后
  刷新控制台即生效,dev / preview 一致,无需重建前端。

## 4. 最小示例

```html
<!-- page/index.html -->
<script src="_bridge.js"></script>
<script src="index.js"></script>
<main id="app"></main>
```

```js
// page/index.js
const host = LibraPluginHost.usePluginHost();

async function run() {
  if (!host.selectedAgent) { app.textContent = '请先在控制台顶部选择设备'; return; }
  const res = await host.dispatchTask('showcase', { capability: 'whoami' });
  app.textContent = typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2);
}
run();
```
