# Libra-Nextgen 插件体系设计

## 1. 目标

允许第三方开发者用**一个压缩包**交付一个完整插件，插件贯通三层：

- **module/**（Agent 端）：编译好的平台共享对象（Rust `cdylib`，`.dll` / `.so`），被 Agent 内存加载执行。
- **service/**（服务端逻辑）：声明式的动作契约 + 可选的受限服务端逻辑。
- **page/**（前端）：HeroUI 页面（`.tsx` / `.jsx`），运行时注册路由、图标、Label 与 i18n。

插件管理页提供**导入、新建、编辑、删除、启用/禁用**五种操作。

## 2. 插件包形态

压缩包格式不限（`.zip` / `.7z` / `.rar`），内部必须有一个 `meta.json`，目录为：

```
<plugin>.zip
├── meta.json              # 必需，插件唯一真源
├── module/                # 可选，Agent 端模块（按平台分目录）
│   ├── x64/foo.dll
│   ├── x86/foo.dll
│   └── linux-x64/foo.so
├── service/               # 可选，服务端逻辑（.ts / .js）
│   └── logic.js
├── page/                  # 可选，前端页面（.tsx / .jsx）
│   └── index.tsx
└── assets/                # 可选，图标等静态资源
```

## 3. meta.json 契约

```jsonc
{
  "schemaVersion": 1,
  "pluginId": "com.example.soft-recon",      // 全局唯一，[a-z0-9._-]
  "name": "某软件信息探测",                     // 显示名
  "version": "1.0.0",
  "author": "user",
  "description": "针对某软件的信息探测插件",
  "entry": {                                   // 前端入口
    "route": "anothersoft",                    // 路由路径（相对于 /plugins/）
    "label": "nav.anothersoft",                // i18n key
    "icon": "Cpu",                             // 图标名，见 §6
    "apiRoot": "/api/plugins/anothersoft"      // 前端调用的后端前缀
  },
  "i18n": {                                    // 可选，前端文案
    "zh": { "nav.anothersoft": "某软件探测" },
    "en": { "nav.anothersoft": "Soft Recon" }
  },
  "actions": [                                 // 动作契约，驱动前端按钮 → 后端 → Agent
    {
      "action": "probe",
      "label": "探测目标",
      "method": "POST",
      "argsSchema": {
        "type": "object",
        "properties": {
          "target": { "type": "string", "title": "目标" }
        },
        "required": ["target"]
      },
      "module": {
        "name": "soft_recon",                  // Agent 端 ModuleManager 下载的模块名
        "op": "probe"                          // 传给 module_main 的 JSON 里的 op
      }
    }
  ]
}
```

## 4. 服务端拓展模型（回答“服务端怎么拓展”）

服务端**不加载第三方代码进主进程**。两条路径：

1. **声明式（默认，90% 插件）**：只写 `meta.json` 的 `actions`。宿主引擎
   `PluginGateway` 固定实现“前端请求 → 校验 argsSchema → 组装任务包 → 经
   WebSocket 下发 Agent → 回收结果 → 推送 Console”。插件作者不写服务端代码。
2. **进程外逻辑（复杂插件）**：`service/` 目录提供 `.js`，由受控解释器在
   **独立沙箱**里执行，只能调用 `sdk.task.dispatch()` / `sdk.log()` 等白名单
   API，不能碰文件系统、网络、反射。宿主负责超时熔断、最小权限、审计。

无论哪条路径，鉴权（JWT）、审计（AuditMiddleware）、参数校验（argsSchema）、
结果持久化（MongoDB）都由宿主强制，插件无法绕过。

## 5. Agent 端（Rust 内存模块）

复用已有 `libra-load` 内存加载机制。插件模块是 `cdylib`，导出：

```rust
#[no_mangle]
pub extern "C" fn module_name() -> *const u8 { ... }           // 必须等于 meta.module.name
#[no_mangle]
pub unsafe extern "system" fn module_main(
    input: *const u8, input_len: usize,
    output: *mut u8, output_cap: usize,
) -> usize { ... }                                             // 输入/输出 JSON
```

Agent 端交互通过一条**通用插件消息通道**（见 `ws_type::PLUGIN_EXEC`），不再为
每个新插件硬编码 dispatcher 分支。服务端下发的任务包里带 `module` + `op`，
`ModuleManager` 按需下载该模块后内存加载执行。

插件模块需编译的产物放进 `module/<platform>/<name>.{dll|so}`，与服务端现有
`build-output/modules/<platform>/` 托管方式一致。

## 6. 前端（HeroUI 子页面 + 共享状态）

- 页面写在 `page/index.tsx`，通过 `usePluginHost()` 拿到 `selectedAgent`、
  `dispatchTask`、`subscribeOutput` 等共享状态（基于现有 `AgentContext`）。
- 宿主在启动后 `GET /api/plugins/manager/manifests`，动态把 `<Route>` 注入
  `App.tsx` 的 `<Routes>`，把菜单项追加进 `sidebarItems`。
- `entry.icon` 用名字串映射到 `@gravity-ui/icons` 的图元（受限白名单，杜绝任意
  import）。
- i18n 文案由 `meta.json` 的 `i18n` 段注入宿主 i18n 实例。

### 6.1 页面组件的编译与注册（实际实现）

前端是 Vite 构建产物，**无法在运行时编译任意 `.tsx` 源码**。因此页面组件采用
**构建期注册表**方案（不引入 Module Federation 的复杂度）：

1. 插件作者把页面组件放进前端仓库的 `src/plugins/<pluginId>/index.tsx`。
2. `src/plugins/registry.ts` 用 `import.meta.glob('../plugins/*/index.tsx')`
   把它们收集为**懒加载 chunk**（`React.lazy`），不进入首屏 bundle。
3. 运行时 `useRegisteredPlugins()` 拉取后端 enabled 清单，按 `pluginId` 把
   清单里的 route/apiRoot/actions 与已编译页面组件对齐。
4. `App.tsx` 据此动态生成 `<Route>` + 侧边栏菜单项 + 页面标题。

`usePluginHost()` 是插件页面的宿主 API：

| 成员 | 说明 |
|---|---|
| `selectedAgent` | 复用控制台当前选中 Agent（共享状态） |
| `selectAgent(id)` | 切换 Agent（与顶部选择器联动） |
| `dispatchTask(pluginId, action, args, agentId?)` | 调动作网关 → Agent 模块，返回结果 |
| `subscribeOutput(cb, action?)` | 订阅 WebSocket 上的 `plugin.result` 流 |
| `lastOutput` | 最近一次插件结果 |

### 6.2 端到端数据流

```
插件页面(usePluginHost.dispatchTask)
  → POST /api/plugins/{pluginId}/{action}  {agentId, args:{target}}
  → PluginActionController 校验 meta + 组装 input={op, ...args}
  → RelayService.RelayAndWaitAsync("plugin.exec", {module, action, input})
  → Agent dispatcher → ModuleManager 下载 module → module_main(input)
  → 回传 plugin.result（request_id 关联 REST 响应；WS 广播流）
  → 页面渲染 result / 流式输出
```

## 7. 生命周期（启用/禁用）

- **导入/新建/编辑**：写入 Mongo `plugins` 集合 + 解包到 `plugins/<pluginId>/`。
- **启用**：模块被 service 托管到 `build-output/modules/<platform>/`，前端开始
  注册路由与菜单，动作网关开放。
- **禁用**：动作网关返回 409，前端移除路由/菜单，模块停止下发（不删除）。
- **删除**：清理托管目录 + Mongo 记录 + 解包文件。

## 8. 示例插件（`examples/soft-recon/`）

仓库内附一个完整示例，演示三层打通：

```
examples/soft-recon/
├── meta.json                 # 插件契约（route=anothersoft, action=probe）
├── module/soft_recon.rs      # Agent 端 cdylib 模块（导出 module_name/module_main）
└── (前端页面)                 # 参见 src/webapp/src/plugins/com.example.soft-recon/index.tsx
```

前端示例页面见 `src/webapp/src/plugins/com.example.soft-recon/index.tsx`，它
调用 `usePluginHost().dispatchTask('com.example.soft-recon', 'probe', {target})`
完整走通「按钮 → 后端 → Agent 模块 → 结果渲染」。
