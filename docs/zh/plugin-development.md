# 插件开发教程

插件以 **zip 包**交付,在 Console **插件管理页**导入/启用。一个插件 = 一个 zip,
可只做一层,也可三层全做。**前端页面为纯 HTML+JS+CSS,无需编译、无需重建控制台**。

## 插件的三层结构

| 层 | 位置(zip 内) | 作用 | 何时需要 |
| --- | --- | --- | --- |
| **Agent 模块** | `module/` | 在目标机器执行采集/操作 | 需要调用 Agent 能力 |
| **前端页面** | `page/` | Console 里的 UI(HTML+JS+CSS) | 需要自定义展示/交互 |
| **服务端脚本** | `service/` | 服务端自定义逻辑(C# 脚本,Roslyn 解析执行) | 需要替前端发网络请求/算签名/读包内文件 |

## zip 结构

```
plugin.zip
├── meta.json          # 插件契约（必需，zip 根目录）
├── module/            # Agent 端模块
│   ├── xxx.js            #   script 通道（JavaScript/QuickJS，免编译，推荐）
│   └── x64/xxx.dll    #   native 通道（按平台分目录：x64/linux-x64）
├── page/              # 前端页面（纯 HTML+JS+CSS，运行时加载）
│   ├── index.html
│   ├── index.js
│   └── index.css
├── service/           # 服务端 C# 脚本（main.cs + 工具类，多文件拼接编译）
└── assets/            # 静态资源（经 /api/plugins/<pluginId>/assets/<文件> 匿名服务）
```

## meta.json 契约

```jsonc
{
  "schemaVersion": 1,
  "pluginId": "com.example.xxx",   // 仅字母/数字/. /- /_，建议反向域名
  "name": "插件名",
  "version": "1.0.0",
  "author": "libra",
  "description": "一句话描述",
  "entry": {
    "route": "xxx",          // 页面路由 /plugins/xxx
    "label": "nav.xxx",      // i18n 键
    "icon": "Puzzle",        // 图标名（控制台白名单映射，见 docs/plugins/README.md）
    "apiRoot": "/api/plugins/com.example.xxx"
  },
  "i18n": { "zh": { "nav.xxx": "插件名" }, "en": { "nav.xxx": "Plugin" } },
  "actions": [
    {
      "action": "collect",          // 动作名（页面 dispatchTask 用）
      "label": "采集",              // 按钮文案
      "method": "POST",
      "argsSchema": {               // 参数 JSON Schema
        "type": "object",
        "properties": { "capability": { "type": "string", "title": "能力名" } },
        "required": []
      },
      "module": {
        "kind": "script",           // script=JavaScript(QuickJS) / native=cdylib
        "name": "xxx",              // .js 文件 stem 或 .dll/.so 文件名
        "op": "collect",            // 注入模块输入 JSON 的 op
        "entry": "main"             // script 入口函数（默认 main）
      }
    }
  ]
}
```

## Agent 通道

### script（JavaScript / QuickJS，推荐）

`module/xxx.js` 入口 `function main(args)`，`args` 是服务端组装的输入（含 `op`），
返回值会被 JSON 序列化作为结果：

```js
function main(args) {
    const op = args.op ?? "all";
    let out;
    if (__platform() === "windows") {
        out = cmd("whoami");                 // Windows：CMD
    } else {
        out = shell("uname -a");             // Linux/macOS：/bin/sh
    }
    return { op, out };
}
```

沙箱为裸 QuickJS 运行时（无 `fetch`/`require`/`console`/`eval`，日志用 `log()`）；
平台分支用 `__platform()`（返回 `"windows" | "linux" | "macos" | "unknown"`）**运行时**
判断，平台专属函数只在对应平台注册。平台 API 速查：

| 通用 | Windows | Linux/macOS |
| --- | --- | --- |
| `fs.read/write/list/exists` | `cmd` / `powershell` | `shell` / `bash` |
| `proc.list()/kill(pid)` | `reg_query/set/delete` | `uname` / `hostname` |
| `env.get` / `whoami` / `log` | `ipconfig` / `wmic` / `tasklist` | `ip_route` / `ss` / `dns` |
| `exec.run/spawn`（fork-and-run） | | |

`exec.run(program, args, {env, cwd, timeoutSeconds})` 在独立子进程执行并等待结果
（Linux = fork+exec，Windows = CreateProcessW）；`exec.spawn(...)` 脱胎启动后台进程
返回 PID。子进程与 Agent 隔离，崩溃/超时不影响 Agent 本体：

```js
var r = exec.run("/bin/sh", ["-c", "echo $MY_VAR"], { env: { "MY_VAR": "value" }, cwd: "/tmp", timeoutSeconds: 30 });
// {"success":true,"exitCode":0,"stdout":"value\n","stderr":"","timedOut":false}
```

### native（cdylib）

`module/<platform>/xxx.dll|so` 导出（`libra-load` ABI）：

```rust
#[no_mangle] pub extern "C" fn module_name() -> *const u8 { concat!("xxx\0").as_ptr() }
#[no_mangle] pub unsafe extern "system" fn module_main(
    input: *const u8, input_len: usize, output: *mut u8, output_cap: usize) -> usize { … }
```

`module_name` 必须与 `meta.json` 的 `module.name` 一致（自校验）；输入输出均为 UTF-8 JSON。

## 服务端脚本（service/）

`service/*.cs` 随 zip 分发,由服务端 `ServerScriptService` 用 Roslyn 解析执行
(多文件按文件名排序拼接编译,结果按插件缓存,文件变更自动失效)。入口文件返回
`Dictionary<string, Func<object, object>>` 的函数表,由
`POST /api/plugin/<pluginId>/<fn>` 驱动,body 任意 JSON 会变成脚本函数的 `p`(dynamic):

```csharp
using System;
using System.Collections.Generic;

public static class Entry
{
    public static object Echo(dynamic p) => new { ok = true, data = new { text = (string)p?.text } };
    public static object Now(dynamic p) => new { ok = true, data = DateTime.Now.ToString((string)p?.format ?? "yyyy-MM-dd HH:mm:ss") };
}

// 文件末尾必须返回函数表:
return new Dictionary<string, Func<object, object>> {
    ["echo"] = Entry.Echo,
    ["now"] = Entry.Now,
};
```

- 可引用库:`System.Net.Http` / `System.Text.Json` / `Linq` 等(见 `ServerScriptService` 的 ScriptOptions)
- 同步签名,内部可用 `.GetAwaiter().GetResult()` 等待异步(如 HttpClient)
- 抛异常统一返回 `{ ok: false, error }`;宿主按插件缓存编译结果,`file` 函数可读包内文件

## 前端页面（page/，纯 HTML+JS+CSS）

页面**运行时加载,无需编译、无需重建控制台**。控制台拉取 `page/index.html` 后向
`<head>` 注入 `<base>` + SDK,以 sandbox iframe 渲染;**页面直接使用注入的
`window.Libra`**,不需要引用任何 SDK 文件:

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
// page/index.js —— SDK 已注入，直接使用 window.Libra
const host = Libra.usePluginHost();

async function run() {
  if (!host.selectedAgent) { app.textContent = '请先在控制台顶部选择设备'; return; }
  const res = await host.dispatchTask('collect', { capability: 'whoami' }); // pluginId 可省略
  app.textContent = typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2);
}
run();
```

SDK 能力:

| 成员 | 说明 |
| --- | --- |
| `Libra.pluginId` | 当前插件 id |
| `Libra.getApiOrigin()` | 后端地址(跨源 fetch 资源请用它拼绝对 URL) |
| `Libra.usePluginHost()` | `selectedAgent` / `selectAgent` / `dispatchTask(pluginId?, action, args?, agentId?)` / `subscribeOutput(cb, action?)` / `lastOutput` |
| `Libra.api.get/post/put/delete(path, body?)` | 带 JWT 的后端 API 调用(路径不含 `/api` 前缀) |

完整契约与约定(零外部依赖 / CSS 自包含 / 深浅色)见
[HTML 插件页面 SDK](plugins/html-plugin-sdk.md)。

## 插件市场（Libra-Plugins）

- 独立仓库存放插件源码与 `*.zip` + `index.json`(CI 在 zip 变化时自动重建索引)
- Console「插件市场」直接从 GitHub raw 拉取 index.json(localStorage 缓存 **1 小时**),
  一键安装 = 下载 zip → 走导入流程
- `index.json` 由 `build-index.ps1` 生成,**不要手工编辑**

## 导入方式

| 方式 | 说明 |
| --- | --- |
| **上传插件** | 选 zip 包导入并启用 |
| **从 Git 导入** | 输入 Git 链接,服务端 `git clone` 到插件目录,**以仓库名为 pluginId**(仓库根需有 meta.json) |
| **插件市场** | 从 Libra-Plugins 索引一键安装 |

## 开发须知

1. `meta.json` 必须在 zip **根目录**,键名 camelCase(`pluginId`/`argsSchema`)
2. `pluginId` 只允许 `[A-Za-z0-9.\-_]`;文件名/资源名走白名单校验
3. script 通道改脚本即生效(重新导入/重启后 Agent 按需下载);native 通道要重新编译 +
   **重启 Agent 丢弃内存缓存**,且若重建过 `build-output` 需把插件 dll 重新 stage
   (插件管理页禁用再启用即可重新 stage)
4. `argsSchema` 只做表单与轻校验,真正的输入校验在脚本/模块里做
5. 中文/多行返回值用 JSON 序列化,避免手工拼字符串出错
6. **仓库边界**:已安装插件目录(`src/plugins` 等)是运行时状态,**不入 git**;
   插件源码统一维护在独立仓库 Libra-Plugins

## 示例插件

| 插件 | 说明 |
| --- | --- |
| `com.example.plugin-sdk` | 开发教程活文档页(5 页签)+ 全功能多平台模块 + 服务端脚本演练 |
| `com.libra.qqkey` | 探测本机 QQ ClientKey,自动加载列表+头像,业务操作(说说/资料/群组等) |
| `com.libra.aitoken` | 获取本机 AI Agent 工具 APIKey,进页自动扫描,按厂商分组显示 |
| `com.libra.av-list` | 杀软检测(识别产品/匹配进程/平台) |
| `com.libra.browser-stealer` | 浏览器密码/历史:分页加载、搜索、CSV 导出 |
| `com.libra.wechat-file` | 微信账号目录与文件月目录浏览、下载 |
