# 插件开发 SDK 教程（com.example.plugin-sdk）

这是一个可直接导入 Libra-Nextgen 的插件包，同时是一份**从零开始的插件开发教程**。
读完本文件，你可以照着写出自己的插件并导入系统。

---

## 1. 插件是什么

Libra-Nextgen 的插件由**三层**组成，每一层都可选、各自独立：

| 层 | 位置 | 作用 | 何时需要 |
|----|------|------|----------|
| **Agent 模块** | `module/` | 在目标机器上执行采集/操作逻辑 | 需要调用 Agent 能力（执行命令、读文件、采集凭据等） |
| **前端页面** | `page/` | 控制台里的 UI 页面 | 需要自定义展示/交互（按钮、表格、表单） |
| **服务端逻辑** | `service/` | 服务端自定义接口 | 需要服务端侧处理（当前版本沙箱未加载，占位） |

一个最小插件可以只有 `meta.json` + 一个 `.rhai` 脚本，也可以带上完整的前端页面和静态资源。

---

## 2. 目录结构

```
com.example.plugin-sdk/
├── meta.json                  # 插件契约（必需，缺一不可）
├── module/                    # Agent 端模块
│   ├── plugin_sdk.rhai        #   script 通道：Rhai 脚本，无需编译
│   ├── x64/                   #   native 通道：按平台目录放置编译产物
│   │   └── plugin.dll         #     Windows x64
│   ├── x86/plugin.dll         #     Windows x86
│   └── linux-x64/plugin.so    #     Linux x64
├── page/                      # 前端页面源码（分发用）
│   └── index.tsx              #   HeroUI 页面，默认导出 React 组件
├── service/                   # 服务端逻辑（占位，当前不加载）
└── assets/                    # 静态资源（图标/图片）
    └── logo.svg               #   经 /api/plugins/<pluginId>/assets/<文件> 访问
```

打包时直接把这个目录打成 zip（`meta.json` 必须在 zip 根目录）。

---

## 3. meta.json 编写说明

`meta.json` 是插件的**唯一契约文件**，服务端据此登记插件、前端据此渲染按钮、Agent 据此执行模块。

### 3.1 完整示例（含注释）

```jsonc
{
  // 契约版本，固定为 1
  "schemaVersion": 1,

  // 插件唯一 ID：只允许 字母/数字/'.'/'-'/'_'，建议反向域名风格
  "pluginId": "com.example.plugin-sdk",

  // 基本信息
  "name": "插件开发 SDK 示例",
  "version": "1.0.0",
  "author": "libra",
  "description": "标准示例插件：展示插件三层结构与全部平台 API。",

  // 前端注册信息（决定侧边栏入口）
  "entry": {
    "route": "plugin-sdk",                          // 页面路由：/plugins/plugin-sdk
    "label": "nav.pluginSdk",                       // i18n 键，见下方 i18n 字段
    "icon": "Puzzle",                               // @gravity-ui/icons 图标名
    "apiRoot": "/api/plugins/com.example.plugin-sdk" // API 根路径
  },

  // 多语言文案：语言代码 → (键 → 文本)
  "i18n": {
    "zh": { "nav.pluginSdk": "插件 SDK 示例" },
    "en": { "nav.pluginSdk": "Plugin SDK Demo" }
  },

  // 动作列表：每个动作 = 前端一个按钮 + 后端一次转发 + Agent 一次模块调用
  "actions": [
    {
      "action": "showcase",             // 动作名（前端 dispatchTask 用）
      "label": "运行能力展示",           // 按钮文案
      "method": "POST",                 // HTTP 方法（固定 POST）
      "argsSchema": {                   // 参数 JSON Schema（前端据此生成表单）
        "type": "object",
        "properties": {
          "capability": {
            "type": "string",
            "title": "能力名称（whoami/fs/proc/network/system）"
          }
        }
      },
      "module": {                       // 映射到 Agent 模块
        "kind": "script",               // "script"=Rhai 脚本 / "native"=编译产物
        "name": "plugin_sdk",           // 模块名（.rhai 文件名 stem，或 .dll/.so 文件名）
        "op": "showcase",               // 注入到模块输入 JSON 的 op 字段
        "entry": "main"                 // script 通道入口函数名（默认 main）
      }
    },
    {
      "action": "shell",
      "label": "执行 Shell 命令",
      "method": "POST",
      "argsSchema": {
        "type": "object",
        "properties": { "command": { "type": "string", "title": "要执行的命令" } },
        "required": ["command"]         // 必填参数
      },
      "module": { "kind": "script", "name": "plugin_sdk", "op": "shell", "entry": "main" }
    }
  ]
}
```

> JSON 标准不支持 `//` 注释，上面的注释只为讲解；实际文件里用 `examples/plugin-sdk/meta.json` 的纯 JSON。

### 3.2 字段速查表

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schemaVersion` | number | 是 | 固定 `1` |
| `pluginId` | string | 是 | 唯一 ID，仅 `[A-Za-z0-9.\-_]`，建议反向域名 |
| `name` | string | 是 | 显示名 |
| `version` | string | 否 | 语义版本，默认 `1.0.0` |
| `author` | string | 否 | 作者 |
| `description` | string | 否 | 描述 |
| `entry.route` | string | 否 | 页面路由段，访问 `/plugins/<route>` |
| `entry.label` | string | 否 | 侧边栏文案的 i18n 键 |
| `entry.icon` | string | 否 | `@gravity-ui/icons` 图标名 |
| `entry.apiRoot` | string | 否 | 动作网关 API 前缀 |
| `i18n` | object | 否 | `{ 语言: { 键: 文本 } }` |
| `actions[]` | array | 否 | 动作列表（见下） |
| `actions[].action` | string | 是 | 动作名，非空 |
| `actions[].label` | string | 否 | 按钮文案 |
| `actions[].method` | string | 否 | 默认 `POST` |
| `actions[].argsSchema` | object | 否 | 参数 JSON Schema（`type`/`properties`/`required`） |
| `actions[].module.kind` | string | 否 | `script` 或 `native`，默认 `native` |
| `actions[].module.name` | string | 是 | 模块名（`.rhai` 文件 stem 或 `.dll`/`.so` 文件名） |
| `actions[].module.op` | string | 否 | 注入到模块输入 JSON 的 `op` 值 |
| `actions[].module.entry` | string | 否 | script 通道入口函数，默认 `main` |

---

## 4. Agent 端模块

### 4.1 script 通道（推荐，无需编译）

`module/<name>.rhai` 是 Rhai 脚本。服务端调用时会组装输入 JSON：

```json
{ "op": "动作名或 module.op", "...argsSchema 里的参数": "值" }
```

脚本入口函数签名固定为 `fn main(args)`，`args` 就是上面的输入 Map，最后返回一个 Map/字符串作为结果。

```rust
fn main(args) {
    let op = if args.contains("op") { args["op"] } else { "showcase" };

    let result;
    #if(WINDOWS)
        result = #{ "out": cmd("ver") };          // Windows：执行 CMD
    #elif(LINUX)
        result = #{ "out": shell("uname -a") };   // Linux：执行 /bin/sh
    #else
        result = #{ "out": "unsupported" };
    #endif
    result
}
```

**多平台写法**：`#if(WINDOWS)` / `#elif(LINUX)` / `#else` / `#endif` 在**解析前**裁剪，
非本平台分支不会进入引擎，因此不会因为调用不存在的函数而报错。

**平台 API 速查**（与 `modules/script/src/platform_*.rs` 一致）：

| 通用 | 说明 | Windows | 说明 | Linux | 说明 |
|------|------|---------|------|-------|------|
| `fs.read/write/list/exists` | 文件系统 | `cmd(cmdline)` | 执行 CMD | `shell(cmdline)` | 执行 sh |
| `proc.list()/kill(pid)` | 进程 | `powershell(script)` | 执行 PS | `bash(script)` | 执行 bash |
| `env.get(name)` | 环境变量 | `reg_query/set/delete` | 注册表 | `uname()` | 系统信息 |
| `whoami()` | 当前用户 | `ipconfig()` | 网络 | `ip_route()` | 网络 |
| `log(msg)` | 写日志 | `wmic(query)` | WMIC | `ss(path)` | 读 proc/sys |
| | | `tasklist()` | 任务列表 | `hostname()` / `dns()` | 主机名/DNS |

### 4.2 native 通道（性能 / 深度系统调用）

`module/x64/<name>.dll`（或 `linux-x64/<name>.so`）编译为 `cdylib`，导出两个 C ABI 函数：

```rust
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 { concat!("name\0").as_ptr() }

#[no_mangle]
pub unsafe extern "system" fn module_main(
    input: *const u8, input_len: usize,
    output: *mut u8, output_cap: usize,
) -> usize { /* 写 JSON 到 output，返回字节数 */ }
```

- `module_name()` 返回的名字必须与 `meta.json` 的 `module.name` 一致（自校验）。
- `module_main` 的 `input` 是 UTF-8 JSON，返回结果也要是 UTF-8 JSON。
- 产物按平台目录放置：`x64/`、`x86/`、`linux-x64/`，导入时服务端会 stage 到 Agent 可下载目录。

---

## 5. 前端页面（page/）

`page/index.tsx` 是**源码分发**：当前前端是 Vite 构建产物，运行时无法编译 `.tsx`。
要让它生效，需把该文件放进前端仓库并重新构建：

```
src/webapp/src/plugins/com.example.plugin-sdk/index.tsx
```

前端通过 `import.meta.glob('../plugins/*/index.tsx')` 在**构建期**收集页面，路由为
`/plugins/<entry.route>`。页面里用 `usePluginHost()` 拿到宿主能力：

```tsx
import { usePluginHost } from '../../hooks/usePluginHost';

export default function MyPage() {
  const { selectedAgent, dispatchTask, subscribeOutput } = usePluginHost();

  const run = async () => {
    // 调用本插件 meta.json 里声明的动作，agentId 默认取当前选中设备
    const res = await dispatchTask('com.example.plugin-sdk', 'showcase', { capability: 'whoami' });
    console.log(res.result);
  };
  // ...
}
```

`usePluginHost()` 提供的 API：

| 成员 | 说明 |
|------|------|
| `selectedAgent` | 当前选中设备（与顶部选择器共享） |
| `selectAgent(id)` | 切换设备 |
| `dispatchTask(pluginId, action, args?, agentId?)` | 调用插件动作，返回 `{pluginId, action, result}` |
| `subscribeOutput(cb, action?)` | 订阅 WebSocket 推送的 `plugin.result`，返回取消函数 |
| `lastOutput` | 最近一次插件结果 |

页面组件从 `@heroui/react` 导入（Button/Card/Table/Accordion/Modal/Tabs 等），完整列表见
https://heroui.com/cn/docs/react/components 。

---

## 6. 静态资源（assets/）

`assets/` 下的文件经匿名端点访问（图片请求无法带 JWT）：

```
GET /api/plugins/<pluginId>/assets/<文件名>
```

文件名只允许字母/数字/`.`/`-`/`_`。前端用 `import { API_ORIGIN } from '../../api/client'`
拼 URL 即可。

---

## 7. 开发须知（避坑清单）

1. **`meta.json` 必须在 zip 根目录**，键名区分大小写（camelCase，如 `pluginId`/`argsSchema`）。
2. **`pluginId` 只允许** `[A-Za-z0-9.\-_]`；导入时会校验，非法字符直接拒绝。
3. **前端页面不会随 zip 热更新**——它是构建期产物，改 `page/index.tsx` 后要放进
   `src/webapp/src/plugins/<pluginId>/index.tsx` 并重建前端。
4. **script 通道改脚本即生效**（重新导入或重启后，Agent 按需下载）；**native 通道要重新编译**
   并重打 zip，且 Agent 需重启以丢弃内存中已加载的旧模块。
5. **动作参数**：`argsSchema` 只做前端表单 + 服务端轻校验，真正的输入校验在脚本/模块里做。
6. **路径安全**：文件名/资源名会被白名单校验，不要在 `pluginId`、`route`、资源名里用
   `..`、`/`、空格等字符。
7. **Git 导入**：控制台「从 Git 导入」会 clone 仓库到插件目录，**以仓库名为 pluginId**，
   要求仓库根目录有 `meta.json`。

---

## 8. 导入与验证

1. 控制台 → 插件管理 → **上传插件**（选 zip）或 **从 Git 导入**（填 git 链接）。
2. 启用插件后，侧边栏出现入口（本示例为「插件 SDK 示例」），Agent 端模块会在动作触发时按需下载。
3. 前端页面（本仓库内联构建）打开后是"活文档"：概览 / Shell 演示 / HeroUI 组件 / 平台脚本 API 四个 tab。
