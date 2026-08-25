# Libra-Nextgen 插件开发指南（LLM 专用）

> 本文档是**给 LLM（AI 编程助手）看的插件开发唯一文档**。读完本文即可开发、构建、
> 调试、发布插件，无需再读其他源码。所有路径、接口、库、契约均以当前仓库为准。
>
> 系统名：**Libra-Nextgen**（红蓝对抗 C2 框架）。插件系统分三层：**Agent 模块**
> （在目标设备上执行）、**服务端脚本**（在 TeamServer 上执行）、**前端页面**
> （在控制台 Web UI 上渲染）。一个插件 = 一个 zip 包，可只做一层，也可三层全做。

---

## 0. 一次性结论（速览）

| 问题 | 答案 |
|---|---|
| 用什么语言开发 | 四选一/组合：**Rhai**（Agent 脚本，无需编译）、**Rust**（Agent 原生 cdylib）、**C#**（服务端脚本，Roslyn 执行）、**TypeScript/React**（前端页面） |
| 有什么库可调用 | Agent 脚本：内建 `fs/proc/env/whoami/log` + 平台命令；Agent 原生：Rust 生态（tokio/serde_json 等）+ `libra_common`；服务端：`System.Net.Http/System.Text.Json/Linq` 等 .NET 库；前端：`@heroui/react` 全部组件 + 宿主 `usePluginHost` / `api` client |
| 结构是什么样子 | 一个约定目录树（见 §3），zip 根 = `meta.json` |
| 怎么跑起来 | 导入 zip → 启用 → 控制台点动作 / 页面调接口（见 §10） |

完整参考实现：仓库内 `com.example.plugin-sdk` 插件（三层全能力演示，见 §11）。
照抄它的结构写新插件最快。

---

## 1. 三层架构

```
┌────────────────────────────────────────────────────────────────┐
│ 控制台（浏览器）                                               │
│   page/index.tsx   ← 前端页面（TSX + HeroUI）                  │
└──────────────┬───────────────────┬─────────────────────────────┘
               │ POST /api/plugins/│ POST /api/plugin/
               │ {pluginId}/{action}│ {pluginId}/{fn}
               ▼                   ▼
┌─────────────────────────┐  ┌──────────────────────────────┐
│ TeamServer（.NET 10）   │  │ ServerScriptService（Roslyn） │
│ PluginActionController  │  │ 执行 service/main.cs（C#）    │
│ 校验 meta + 转发到 Agent │  └──────────────────────────────┘
└────────────┬────────────┘
             │ WebSocket: plugin.exec（script=内嵌 .rhai 源码 / native=模块名）
             ▼
┌─────────────────────────┐
│ Agent（Rust，目标设备） │
│  script 通道：Rhai 引擎  │  ← 无需编译，源码内嵌执行
│  native 通道：cdylib    │  ← 需编译，按名从服务器下载后内存加载
└─────────────────────────┘
             │ 执行结果经 WS 推送：plugin.result
             ▼
      控制台页面实时收到结果（subscribeOutput）
```

- **Agent 模块**：随 action 下发，在目标设备上执行。两种通道：
  - `script`：`.rhai` 脚本，**无需编译**，服务端把源码随消息发给 Agent，Rhai 引擎内存执行。
  - `native`：Rust 编译的 cdylib，Agent 按模块名从服务器下载（`build-output/modules/<平台>/`），**内存加载**（Windows 临时文件映射即删；Linux memfd），调用 `module_main`。
- **服务端脚本**：`service/main.cs`（C# 脚本），随 zip 分发，由 `ServerScriptService` 用 Roslyn 解析执行，编译结果按插件缓存（文件变更自动失效）。主要用于"替前端发网络请求（无 CORS）、算签名、读包内文件、做业务"。
- **前端页面**：`page/index.tsx`，**源码分发**——必须放进 `src/webapp/src/plugins/<pluginId>/index.tsx` 并重建前端才会出现在控制台（`import.meta.glob` 构建期收集路由）。

---

## 2. 开发目录与运行时目录（先搞清楚文件去哪）

| 阶段 | 路径 | 说明 |
|---|---|---|
| 开发源（服务端脚本） | `src/service/plugins-service/<pluginId>/main.cs` | 存放开发副本；运行时若解压目录没有 main.cs 会回退到这里 |
| 开发源（插件包本体） | `src/plugins/<pluginId>/` | 仓库内联开发时的"运行时目录"，结构 = zip 解压后的样子 |
| 运行时解压目录 | `PluginsBaseDir = src/plugins/`（含导入的 zip 解压结果） | `src/plugins/<pluginId>/` 会被服务端读取 |
| Agent 模块下载目录 | `src/build-output/modules/{x64,x86,linux-x64}/` | native 插件导入时自动把 `module/<平台>/*.dll` **stage** 到这里；Agent 从此下载 |
| 前端页面源 | `src/webapp/src/plugins/<pluginId>/index.tsx` | 唯一生效位置，改完需重建前端 |
| 插件市场 | `Libra-Plugins/`（独立 git 仓库） | 放 zip + 跑 `build-index.ps1` 生成 `index.json` |

> 关键机制（务必理解）：
> - 插件导入/解压后，`service/main.cs` 从 `src/plugins/<pluginId>/service/main.cs` 读取；
>   不存在则回退 `src/service/plugins-service/<pluginId>/main.cs`（开发副本优先权低于运行时目录）。
> - native 插件 `module/<平台>/*.{dll,so}` 在**导入/重启用例**时被复制到 `build-output/modules/<平台>/`（StageModules）；
>   删除插件会取消 stage。改 dll 后如出现 404，重新导入或禁用再启用即可重新 stage。
> - Agent 的 `ModuleManager` 按模块名**内存缓存**已加载模块——Agent 进程重启后才会重新下载。

---

## 3. 插件包结构（zip 内布局 = `src/plugins/<pluginId>/` 布局）

```
<pluginId>/
├── meta.json              # 插件契约（必需。zip 根目录）
├── module/                # Agent 端模块（任一即可）
│   ├── <name>.rhai        #   script 通道：Rhai 源码（name = meta.module.name）
│   ├── x64/<name>.dll     #   native 通道（Windows x64）
│   ├── x86/<name>.dll     #   native 通道（Windows x86）
│   ├── linux-x64/<name>.so#   native 通道（Linux）
├── service/
│   └── main.cs            # 服务端 C# 脚本（可选层）
├── page/
│   └── index.tsx          # 前端页面源码（分发用副本；生效位置见 §2）
├── data/                  # 随包分发的数据/配置文件（main.cs 可读，见 §6.7）
├── assets/                # 静态资源（图标等，经 GET /api/plugins/<id>/assets/<file> 访问）
└── README.md              # 说明（可选）
```

---

## 4. meta.json —— 插件契约（唯一契约，全字段）

```jsonc
{
  "schemaVersion": 1,                 // 固定 1
  "pluginId": "com.you.plugin-name",  // 必填；仅 [A-Za-z0-9.-_]；= 包目录名
  "name": "插件显示名",                // 必填
  "version": "1.0.0",                // 必填；语义化
  "author": "you",                   // 必填
  "description": "一句话说明",         // 必填（市场列表显示）
  "entry": {                          // 前端入口
    "route": "plugin-name",          // 路由 /plugins/<route>
    "label": "nav.pluginName",       // 导航名（i18n 键）
    "icon": "Puzzle",                // 可选；@gravity-ui/icons 图标名
    "apiRoot": "/api/plugins/com.you.plugin-name"  // 可选；页面 API 前缀（约定）
  },
  "i18n": { "zh": { "nav.pluginName": "插件显示名" }, "en": { ... } },  // 可选
  "actions": [                        // 动作 = 按钮 + 转发 + Agent 模块调用
    {
      "action": "showcase",          // 前端 dispatchTask 用
      "label": "运行能力展示",
      "method": "POST",              // GET / POST
      "argsSchema": {                 // 可选；JSON Schema 子集，前端渲染参数表单
        "type": "object",
        "properties": { "capability": { "type": "string", "title": "能力名称" } },
        "required": []
      },
      "module": {                     // 可选；不写 = 纯前端动作（服务器接受但不执行）
        "kind": "script",            // script = .rhai 源码内嵌执行；native = cdylib
        "name": "plugin_name",       // .rhai 文件 stem 或 dll/so 名（不含扩展名）
        "op": "showcase",            // 可选；注入脚本/模块输入 JSON 的 op 字段
        "entry": "main"              // 可选；script 通道的入口函数名，默认 main
      }
    }
  ]
}
```

`argsSchema` 支持：`type: "object"`、`properties: {字段: {type, title}}`、`required: [字段]`。前端按钮会按它生成表单；服务端做 best-effort 结构校验，真正的权威校验在 Agent 模块里。

---

## 5. 第一层：Agent 模块

### 5.1 script 通道（Rhai，推荐 —— 免编译）

**语言**：Rhai（Rust 的脚本语言，类似 JS/Rust 混合体）。无需安装任何东西，改完即用，zip 里带 `.rhai` 即可。

**入口约定**：meta `module.entry`（默认 `main`）。引擎把输入 JSON 展开成名为 `args` 的 map 传入：

```rhai
fn main(args) {
    // args 里一定有 op（= meta.module.op，没配则没有该键），其余是动作参数
    let op = if args.contains("op") { args["op"] } else { "default" };
    let cap = if args.contains("capability") { args["capability"] } else { "all" };
    // ... 业务
    result   // 最后一行 = 返回值；会被 JSON 序列化后经 WS 推给控制台
}
```

**可用 API（内建，直接调用，零依赖）**：

通用（所有平台）：
| API | 说明 |
|---|---|
| `fs.read(path)` | 读文件 → String |
| `fs.write(path, content)` | 写文件 → bool |
| `fs.list(path)` | 列目录 → Array |
| `fs.exists(path)` | 判断存在 → bool |
| `proc.list()` | 进程列表 → [{pid,name}] |
| `proc.kill(pid)` | 杀进程 → bool（危险） |
| `env.get(name)` | 读环境变量 → String |
| `env.set(name, value)` | 写环境变量（多线程下是安全 no-op 占位，勿依赖） |
| `whoami()` | 当前用户名 |
| `log(msg)` | 打印到 Agent 日志（控制台日志流可见） |

Windows 专属：
| API | 说明 |
|---|---|
| `cmd(cmdline)` | 执行 CMD |
| `powershell(script)` | 执行 PowerShell |
| `reg_query(key, name)` / `reg_set(key,name,data)` / `reg_delete(key,name)` | 注册表读写删 |
| `ipconfig()` / `wmic(query)` / `tasklist()` | 网络/系统/进程 |

Linux 专属：
| API | 说明 |
|---|---|
| `shell(cmdline)` / `bash(script)` | 执行 sh/bash |
| `uname()` / `hostname()` / `dns()` | 系统信息 |
| `ip_route()` | 网络接口/IP |
| `ss(path)` | 读 /proc /sys |

**多平台条件编译**（解析期裁剪，非本平台代码直接删除，不报错）：

```rhai
#if(WINDOWS)
    let out = ipconfig();
#elif(LINUX)
    let out = ip_route() + "\n" + dns();
#else
    let out = "unsupported";
#endif
```

**Rhai 语法要点**（LLM 易错）：
- map 字面量 `#{}`，与 JS 对象不同；数组是 `[...]`。
- 字符串拼接 `+`；`if/else if/else`、`let`；函数 `fn name(args) {}`。
- 取键：`m["key"]` 或 `m.key`；判断存在：`m.contains("key")`。
- map 里可直接嵌套 map/数组，引擎会自动 JSON 序列化（中文/嵌套都安全）。

**最小完整示例**（`module/plugin_demo.rhai`）：

```rhai
fn main(args) {
    let op = if args.contains("op") { args["op"] } else { "info" };

    if op == "info" {
        #{
            "platform": __platform(),
            "user": whoami(),
            "procs": proc.list().len,
        }
    } else if op == "files" {
        #{
            "home": fs.list("."),
            "tmp_exists": fs.exists("/tmp"),
        }
    } else if op == "shell" {
        let command = if args.contains("command") { args["command"] } else { "whoami" };
        #if(WINDOWS)
            #{ "output": cmd(command) }
        #elif(LINUX)
            #{ "output": shell(command) }
        #else
            #{ "output": "unsupported" }
        #endif
    } else {
        #{ "error": "unknown op" }
    }
}

fn __platform() {
    #if(WINDOWS) "windows" #elif(LINUX) "linux" #else "unknown" #endif
}
```

### 5.2 native 通道（Rust cdylib）

**语言**：Rust。**只能用 `#[no_mangle] pub unsafe extern "system"` ABI**（见 `libra-load`）：

```rust
// 自识别名：必须与 meta.json module.name 完全一致（防错下载检测）
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 {
    concat!("my_plugin", "\0").as_ptr() as *const u8
}

// 入口：input 是一段 JSON 文本（{"op":..., ...参数}）；把结果 JSON 写进 output，
// 返回写入字节数。output 容量 16MB，写不下会被截断报错。
#[no_mangle]
pub unsafe extern "system" fn module_main(
    input: *const u8, input_len: usize,
    output: *mut u8, output_cap: usize,
) -> usize { /* ... */ }
```

**工程组织**：
- 新建 crate：`src/agent-rs/plugins/<name>/Cargo.toml`，`[lib] crate-type = ["cdylib"]`，并把它加进 `src/agent-rs/Cargo.toml` 的 workspace members。
- 可用依赖：`serde_json`、`tokio`（自带 `new_current_thread` runtime 即可做 async，参考 qqkey）、标准库；以及本 workspace 的 `libra_common`（模型）、`libra_platform`（executor）等。
- 构建：`cargo build --release -p <name>`（产物在 `src/agent-rs/target/release/<name>.dll`）。
- 部署：把 dll 拷到 `src/plugins/<pluginId>/module/x64/<name>.dll`（Linux 对应 linux-x64/*.so），**重新导入或禁用/启用插件**触发 stage 到 `build-output/modules/x64/`（否则 Agent 下载 404）。

**结果格式约定**：成功返回 JSON，如 `{"success":true,"output":"..."}` 或业务对象；失败返回 `{"error":"原因"}`。控制台按"是否含 error 键"判断成败。

**结构范例**：`src/agent-rs/plugins/qqkey/src/lib.rs`（完整可抄：module_name + module_main + write_output + run_async 模板）。

---

## 6. 第二层：服务端脚本（service/main.cs）

**语言**：C#（**Roslyn C# Scripting**，不是完整 ASP.NET 工程，是脚本文件）。随 zip 分发，服务端运行时编译并缓存。

**入口契约**（文件末尾必须这样返回）：

```csharp
return new Dictionary<string, Func<object, object>>
{
    ["myfn"] = p => MyFn((dynamic)p),
    // ... 每个导出函数一个键
};
```

- 请求 `POST /api/plugin/<pluginId>/<fn>`，body 任意 JSON → 变成函数参数 `p`（dynamic；body 为空时 p=null）。
- 函数返回值作为响应的 `data` 字段（对象自动 JSON 序列化）。
- 函数抛异常 → 响应统一为 `{ "ok": false, "error": "<消息>" }`（**错误契约**）。
- 成功响应：`{ "ok": true, "data": <返回值>, "plugin": "<id>", "fn": "<fn>" }`。
- 还可用 `GET /api/plugin/list` 列出所有含 main.cs 的插件及其函数（宿主会逐个编译执行一次）。

**可用库（宿主已引用）**：
- using 已注入：`System`、`System.Net`、`System.Net.Http`、`System.Text`、`System.Text.Json`、`System.Threading.Tasks`、`System.Collections.Generic`、`System.Dynamic`、`System.Linq`。
- 即：`HttpClient`（网络请求，服务端发起**无 CORS**）、`JsonSerializer`/`JsonDocument`、LINQ、`Dictionary`/`List` 等开箱即用；其他 .NET 类型可用**全限定名**（如 `System.IO.Path.Combine`、`System.Diagnostics.Stopwatch`），但未引用的程序集（如 System.Security.Cryptography）不可用。

**能力点（照着用）**：

```csharp
// 1) 网络请求（同步签名内阻塞等待异步）
using var c = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true })
{ Timeout = TimeSpan.FromSeconds(15) };
c.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0");
var resp = c.GetStringAsync(url).GetAwaiter().GetResult();

// 2) 动态参数：p?.字段 直接读（支持任意嵌套）
var text = p?.text;            // dynamic
var n = Convert.ToInt32(p?.count ?? 0);

// ⚠️ 坑：把 dynamic 传给普通方法（如你的辅助函数）会导致整次调用变成动态调度，
//    返回值类型也变成 dynamic（后续 LINQ/lambda 会报 CS1977）。
//    正确做法：先做静态转换 (object?)p?.字段 再传参。
static string Str(object? v, string def = "") => v?.ToString() ?? def;
var s = Str((object?)p?.text, "默认值");

// 3) 跨调用内存状态：声明类型 + 静态字段（脚本程序集只编译一次，多次调用间保留；
//    服务重启清零）
static class MyState { public static int Calls; }
MyState.Calls++;

// 4) 读插件包内随包分发的文件（data/xxx.json 等）
//    定位插件根目录：AppContext.BaseDirectory 向上 4 级 + plugins/<pluginId>
var root = System.IO.Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "plugins", "<pluginId>");
var json = System.IO.File.ReadAllText(System.IO.Path.Combine(root, "data/demo.json"));
```

**最小完整示例**（`service/main.cs`，两个函数）：

```csharp
using System;
using System.Net.Http;
using System.Text.Json;
using System.Collections.Generic;

string MyIp(dynamic p)
{
    using var c = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    var resp = c.GetStringAsync("https://api.ipify.org?format=json").GetAwaiter().GetResult();
    using var doc = JsonDocument.Parse(resp);
    return JsonSerializer.Serialize(new { ip = doc.RootElement.GetProperty("ip").GetString() });
}

string MyFail(dynamic p)
{
    throw new InvalidOperationException("演示错误契约");
}

return new Dictionary<string, Func<object, object>>
{
    ["myip"]  = p => MyIp((dynamic)p),
    ["myfail"] = p => MyFail((dynamic)p),
};
```

> 参考完整实现：`src/service/plugins-service/com.example.plugin-sdk/main.cs`（11 个函数，
> 覆盖动态参数/时间/签名/状态/HTTP/读包内文件/数组/错误契约/自描述 manifest）。
> 前端可通过调用其 `manifest` 函数实时拿到函数目录。

---

## 7. 第三层：前端页面（page/index.tsx）

**语言**：TypeScript + React。**组件必须用 HeroUI**（`@heroui/react`，v3 结构式组件 API）。

**生效方式**：把 `page/index.tsx` 同步到 `src/webapp/src/plugins/<pluginId>/index.tsx`，重建前端（`import.meta.glob` 收集），刷新控制台即出现 `/plugins/<route>` 页面。仓库内联开发时直接改 webapp 里的副本。

### 7.1 宿主 API：usePluginHost

```tsx
import { usePluginHost } from '../../hooks/usePluginHost';

const { selectedAgent, selectAgent, dispatchTask, subscribeOutput, lastOutput } = usePluginHost();
```

| 成员 | 签名 | 说明 |
|---|---|---|
| `selectedAgent` | `{id,hostname,ipAddress,...} \| null` | 当前选中设备（与控制台顶部共享） |
| `selectAgent` | `(id: string) => void` | 切换选中设备 |
| `dispatchTask` | `(pluginId, action, args?, agentId?) => Promise<{pluginId, action, result?}>` | 调插件动作 → Agent 执行模块（默认目标 = selectedAgent） |
| `subscribeOutput` | `(cb: (out: PluginOutput) => void, action?: string) => () => void` | 订阅 WS 实时推送（可选按 action 过滤），返回退订函数 |
| `lastOutput` | `{data,agentId,action,ts} \| null` | 最近一条 plugin.result |

```tsx
// 调用 Agent 模块动作
const res = await dispatchTask('com.you.plugin', 'showcase', { capability: 'files' });
// res.result 是模块返回的 JSON 对象

// 实时接收推送（无需等待 dispatchTask 完成，适合长任务）
useEffect(() => subscribeOutput((out) => {
  // out.action / out.data / out.agentId / out.ts
}, 'showcase'), []);
```

### 7.2 HTTP client：api

```tsx
import { api, API_ORIGIN } from '../../api/client';
// 自动带 JWT；401 自动触发登出回调；网络断开抛 'Network unreachable'
await api.get<T>('/agents');
await api.post<T>('/plugin/<pluginId>/<fn>', params);   // 调服务端脚本
await api.put<T>(path, body);
await api.delete<T>(path);
```

### 7.3 插件管理 / 插件市场 API（`../../api/plugins`）

```tsx
import {
  listPlugins, togglePlugin, updatePlugin, deletePlugin, importPlugin,
  importPluginFromGit, getPluginRegistry, installPluginFromRegistry,
} from '../../api/plugins';

listPlugins(): Promise<PluginRecord[]>                       // GET /plugins/manager
togglePlugin(id, enabled) / updatePlugin(id, meta) / deletePlugin(id)
importPlugin(file: File, enable)                             // multipart 上传
importPluginFromGit(gitUrl, enable)                          // 后端 clone 到插件目录（仓库名为 pluginId）
getPluginRegistry(): Promise<PluginRegistryIndex>            // 市场 index.json，直接浏览器 fetch GitHub raw，
                                                             // localStorage('libra.plugin.registry') 缓存 60 分钟
installPluginFromRegistry(file: string)                      // 从市场下载 zip 并导入（fileName 来自 index）
```

### 7.4 HeroUI 组件速查（结构式 API，先会这几个）

```tsx
// Tabs（受控/非受控均可）
<Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))}>
  <Tabs.ListContainer>
    <Tabs.List><Tabs.Tab id="a">A<Tabs.Indicator /></Tabs.Tab></Tabs.List>
  </Tabs.ListContainer>
  <Tabs.Panel id="a">…</Tabs.Panel>
</Tabs>

// Table（标准列表）
<Table>
  <Table.ScrollContainer>
    <Table.Content aria-label="x" className="min-w-[640px]">
      <Table.Header>
        <Table.Column isRowHeader>列1</Table.Column><Table.Column>列2</Table.Column>
      </Table.Header>
      <Table.Body>
        {rows.map((r, i) => (
          <Table.Row key={r.id} id={`row-${i}`}>
            <Table.Cell>{r.a}</Table.Cell><Table.Cell>{r.b}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Content>
  </Table.ScrollContainer>
</Table>

// Modal（所有"结果"都用它弹窗渲染）
<Modal.Backdrop isOpen={open} onOpenChange={(o) => !o && setOpen(false)}>
  <Modal.Container size="lg">   {/* size: sm | md | lg | xs | cover | full（无 xl） */}
    <Modal.Dialog>
      <Modal.CloseTrigger />
      <Modal.Header><Modal.Heading>标题</Modal.Heading></Modal.Header>
      <Modal.Body>…内容…</Modal.Body>
    </Modal.Dialog>
  </Modal.Container>
</Modal.Backdrop>

// ComboBox（下拉选择）
<ComboBox selectedKey={key} onSelectionChange={(k) => setKey(String(k ?? ''))}>
  <Label>标签</Label>
  <ComboBox.InputGroup><Input placeholder="…" /><ComboBox.Trigger /></ComboBox.InputGroup>
  <ComboBox.Popover>
    <ListBox aria-label="x">
      {opts.map((o) => <ListBox.Item key={o.id} id={o.id} textValue={o.label}>{o.label}<ListBox.ItemIndicator /></ListBox.Item>)}
    </ListBox>
  </ComboBox.Popover>
</ComboBox>

// Accordion（工具折叠面板）
<Accordion>
  <Accordion.Item key="t">
    <Accordion.Heading>
      <Accordion.Trigger><span>标题</span><Accordion.Indicator /></Accordion.Trigger>
    </Accordion.Heading>
    <Accordion.Panel><Accordion.Body>…</Accordion.Body></Accordion.Panel>
  </Accordion.Item>
</Accordion>

// 带头像列表（联系人/群组场景）
<Surface className="rounded-3xl">
  <ListBox aria-label="x" selectionMode="multiple">
    <ListBox.Item id="1" textValue="name">
      <Avatar size="sm">
        <Avatar.Image src="…" alt="name" />
        <Avatar.Fallback>N</Avatar.Fallback>
      </Avatar>
      <div className="flex flex-col"><Label>name</Label><Description>sub</Description></div>
      <ListBox.ItemIndicator />
    </ListBox.Item>
  </ListBox>
</Surface>
```

**其余组件**：Button（variant: primary/secondary/tertiary/soft，部分版本还有 ghost/outline/danger）、Chip（variant: secondary/soft/tertiary/primary；color: default/accent/success/warning/danger）、Badge、Input/TextField/TextArea、Switch（`<Switch.Control><Switch.Thumb /></Switch.Control>`）、Checkbox（`<Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>`）、Slider、ProgressCircle(value)、Spinner(size)、Skeleton、Alert（status: default/accent/success/warning/danger；`<Alert.Content><Alert.Title/><Alert.Description/>`）、Tooltip（`<Tooltip.Content placement>`）、Dropdown（`<Dropdown.Popover><Dropdown.Menu><Dropdown.Item/>`）、Kbd、Link。
组件枚举随 `@heroui/react` 版本变化，**以 tsc 报错为准回退到上述安全集合**。

### 7.5 页面最小骨架

```tsx
import { useState } from 'react';
import { Button, Card, Input, Label, TextField } from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';
import { api } from '../../api/client';

export default function MyPluginPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [text, setText] = useState('');
  const [result, setResult] = useState<unknown>(null);

  const runAgent = async () => {
    if (!selectedAgent) return;
    const res = await dispatchTask('com.you.plugin', 'my_action', { text });
    setResult(res.result);
  };

  const runServer = async () => {
    const res = await api.post<{ ok: boolean; data?: unknown; error?: string }>(
      '/plugin/com.you.plugin/myfn', { text });
    setResult(res.ok ? res.data : res.error);
  };

  return (
    <Card className="p-6 space-y-4">
      <TextField variant="secondary">
        <Label>输入</Label>
        <Input value={text} onChange={(e) => setText((e.target as HTMLInputElement).value)} />
      </TextField>
      <div className="flex gap-2">
        <Button variant="primary" onPress={runAgent}>调 Agent 模块</Button>
        <Button variant="secondary" onPress={runServer}>调服务端脚本</Button>
      </div>
      {result !== null && <pre className="font-mono text-xs bg-default-50 p-2 rounded">{JSON.stringify(result, null, 2)}</pre>}
    </Card>
  );
}
```

---

## 8. action 的数据流（前端按钮 → Agent 执行 → 结果回来）

1. 前端 `dispatchTask(pluginId, action, args)` → `POST /api/plugins/{pluginId}/{action}`，body `{agentId, args}`。
2. 服务端校验：插件存在且 enabled、action 在 meta.json 里、args 过 argsSchema 结构校验。
3. 拼模块输入 JSON：`{"op": <module.op>, ...args}`。
4. **script 通道**：服务端读 `src/plugins/<id>/module/<name>.rhai` 源码，WS 发 `plugin.exec` 消息
   `{kind:"script", module, action, entry, script, input}`；Agent 用 Rhai 引擎执行 `entry(input)`。
   **native 通道**：WS 发 `{kind:"native", module, action, input}`；Agent 的 ModuleManager 按名下载 cdylib → 内存加载 → `module_main(input 字节)`。
5. Agent 结果 JSON → WS 推送 `plugin.result`（前端 `subscribeOutput`/`lastOutput` 收到）；HTTP 请求同时返回 `{pluginId, action, result}`。
6. Agent 超时无响应 → HTTP 504 `{error:"Agent did not respond in time."}`。

---

## 9. 服务端脚本的数据流（前端 → main.cs → 返回）

1. 前端 `api.post('/plugin/<pluginId>/<fn>', params)` → `POST /api/plugin/<pluginId>/<fn>`（需登录 JWT）。
2. `ServerScriptService` 找 `src/plugins/<id>/service/main.cs`（无则回退开发目录），按插件缓存编译（文件 LastWriteTimeUtc 变了自动重编，**无需重启服务**）。
3. 执行脚本 → 取 `Dictionary<string, Func<object,object>>` → 调 `<fn>`，body 转 dynamic 传入。
4. 返回 `{ok:true, data}` 或 `{ok:false, error}`。

---

## 10. 完整开发流程（checklist）

1. **建包**：`src/plugins/<pluginId>/` 下写 `meta.json`（§4）+ 至少一层实现（§5/§6/§7）。
2. **同步开发副本**：`service/main.cs` 还可放一份在 `src/service/plugins-service/<pluginId>/`。
3. **导入**：控制台 → 插件管理 → 上传 zip（或从 Git 导入：给仓库地址，后端 clone，以仓库名为 pluginId；或从市场安装）。
4. **启用**：enabled 后动作才能下发、脚本才能被调用。
5. **写页面**：`src/webapp/src/plugins/<pluginId>/index.tsx` → 重建前端 → 刷新。
6. **联调**：页面里 `dispatchTask` 调 Agent 动作；`api.post('/plugin/...')` 调服务端函数；看 WS 推送与响应。
7. **native 模块**：`cargo build --release -p <name>` → 拷 dll 到 `module/<平台>/` → 重新导入或禁用/启用触发 stage。
8. **发布市场**：把 `<pluginId>.zip` 提交到独立仓库 `Libra-Plugins/` 根目录 → 跑 `pwsh build-index.ps1`（生成 `index.json`）→ 提交。控制台市场页即可安装。
9. **清理**：销毁 = Agent 清理持久化并退出；重启 = Agent 拉起自身副本后退出；删除 = 服务端移除记录并取消 stage 模块。

**构建/验证命令**（仓库根）：

```bash
# 前端（src/webapp/）
pnpm install          # lockfile = pnpm-lock.yaml
pnpm run build        # tsc -b && vite build（全量类型检查）
node_modules/.bin/tsc.cmd --noEmit   # 只做类型检查（Windows）
node_modules/.bin/vite.cmd build     # 跳过类型检查直接出包

# 服务端（仓库根）
dotnet build src/service/service.csproj --nologo -v q -o src/service/bin/build-check   # 服务在跑会锁 DLL，务必用 -o 输出到别处
dotnet test src/tests/LibraNextgen.Tests -p:OutputPath=bin/test-out                    # 跑测试（同样避开锁）

# Agent（src/agent-rs/）
cargo check -p libra-engine          # 快速检查
cargo build --release -p <你的模块>   # 编 native 模块
```

---

## 11. 参考实现（直接抄）

| 参考 | 路径 | 覆盖 |
|---|---|---|
| **SDK 全能力演示** | `src/plugins/com.example.plugin-sdk/` | 三层全部特性 + meta 全字段 + 脚本自描述 manifest + 前端五页签活文档 |
| SDK 服务端脚本 | `src/service/plugins-service/com.example.plugin-sdk/main.cs` | 11 个函数的完整写法 |
| SDK 页面 | `src/webapp/src/plugins/com.example.plugin-sdk/index.tsx` | 所有 HeroUI 模式 + 宿主 API + 市场/管理调用 |
| native 插件范例 | `src/agent-rs/plugins/qqkey/` | cdylib ABI + tokio + 平台探测（参考其 lib.rs） |
| 服务端脚本范例 | `src/service/plugins-service/com.libra.qqkey/main.cs` | 真实业务（QQ 空间 API 签名、Cookie、JSONP 解析） |
| 页面范例 | `src/webapp/src/plugins/com.libra.qqkey/index.tsx` | 复杂交互（ComboBox 选账号、Modal 结果分类渲染） |

---

## 12. 常见坑（LLM 开发必读）

1. **Rhai 不是 JS**：map 用 `#{}`，不是 `{}`；`m.contains("key")` 判断键存在；返回体不要写分号结尾的 return 形式（用最后表达式）。
2. **C# 脚本里 dynamic 传染**：`MyHelper(p?.text)` 会变成动态调用、返回 dynamic，后续 LINQ lambda 报 CS1977。先 `(object?)p?.text` 再传。
3. **C# 关键字做匿名成员名**：`default` 要写成 `@default`（`new { @default = "x" }`），否则 CS0746。
4. **main.cs 不是编译进 csproj 的**：`plugins-service/**/*.cs` 已在 `src/service/service.csproj` 里 `<Compile Remove>`，脚本错误只在运行时（服务端日志）暴露。可以自己起一个临时控制台工程引用 `Microsoft.CodeAnalysis.CSharp.Scripting 4.*` 来预编译验证。
5. **脚本缓存**：按文件时间戳失效，改 main.cs 不用重启服务；但**服务端二次编译要等下次调用**。
6. **Agent 模块内存缓存**：native 模块更新后，在线 Agent 仍用旧 dll（除非重启 Agent）；重打包时记得 stage（重新导入/禁用启用），否则 404。
7. **页面是源码分发**：只改 zip 里的 page/index.tsx 不会出现在控制台，必须放 `src/webapp/src/plugins/<id>/index.tsx` + 重建前端。
8. **服务在跑时 DLL 被锁**：`dotnet build` 不带 `-o` 会报 MSB3027，用独立输出目录。
9. **枚举大小写**：前后端 CommandType 走 camelCase（`killAndClean`、`restart`），别用蛇形。
10. **组件变体枚举随版本变**：Button/Chip/Alert 的 variant/color/status 以 tsc 报错为准，收敛到 §7.4 提到的安全集合。
11. **销毁/重启任务**：`POST /api/tasks` 用 `commandType: "KillAndClean" | "Restart"`，且**仅 Admin 角色**可用（403 属正常）。