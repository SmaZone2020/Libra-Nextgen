# 脚本插件（Rhai）设计

## 目标

让插件作者**无需编译环境**也能写 Agent 端模块：用 Rhai 脚本，内嵌
`#if(WINDOWS)/#elif(LINUX)/#else/#endif` 条件编译，且不同平台开放**不同的
API 函数集**（Windows 有 `cmd`/`winapi`，Linux 有 `shell`/`native` 等）。

## 分层

- **第一层：`script` 通用模块（Rhai 沙箱）**——内置在 Agent，是所有脚本
  插件的宿主，无需逐插件编译。通过 `module.kind = "script"` 下发脚本源码。
- **第二层：原生 `cdylib`（保留）**——C/Rust/C++ 编译模块，`module.kind =
  "native"`，给性能/隐蔽性/深度系统调用场景。

## meta.json 契约扩展

```jsonc
"actions": [{
  "action": "probe",
  "module": {
    "kind": "script",          // "script" | "native"
    "name": "soft_recon",      // script: 脚本文件 stem；native: 模块名
    "op": "probe",
    "entry": "main"            // script 可选：入口函数名，缺省 "main"
  }
}]
```

脚本打包路径：`module/<name>.rhai`（纯文本），随插件包交给服务端，服务端
按需通过 `plugin.exec` 里的 `script` 字段直传源码（不落盘）。

## 条件编译语法

用 Rhai 的 `register_custom_syntax` 在**解析期**实现，非目标平台的代码块
直接不进 AST（不是运行时 if）。

```
#if(WINDOWS)
    let out = sys.cmd("ipconfig /all");
#elif(LINUX)
    let out = sys.shell("ip addr");
#else
    let out = "unknown platform";
#endif
```

规则：
- 括号内是逗号分隔的平台名列表，支持 `WINDOWS`/`LINUX`/`MACOS`（大小写不敏感）。
- `#else` 可选；`#endif` 必须。
- 支持嵌套。
- 平台常量由引擎注入（`scope.push_constant("WINDOWS", true)` 等），但裁剪
  在解析期完成，脚本运行前已决定哪段被保留。

## 平台 API 门控

每个平台调用 `Engine::register_fn` 注册**不同的函数集**，函数不存在即编译
报错（调用非本平台 API 会被裁剪掉，若漏裁剪则报"function not found"）。

| 平台 | 暴露的函数 |
|---|---|
| **Windows 通用** | `sys.cmd(cmdline)` 执行 CMD；`sys.powershell(script)`；`fs.read/write/list`；`reg.query/reg.set`；`winapi.call(...)`（受限白名单） |
| **Windows 深度** | `sys.token_*`、`sys.process_inject` 等（`features = ["full"]` 才开） |
| **Linux 通用** | `sys.shell(cmdline)`；`sys.bash(script)`；`fs.*`；`net.ip_route`、`net.iptables` |
| **Linux 深度** | `sys.syscall(nr, ...)`、`proc.mem_read` 等 |

"支持所有功能"通过一个 `features` 开关实现：默认 `core` 功能集（安全、通用），
`full` 功能集开放危险 API。服务端下发脚本时带 `features` 白名单，Agent 据此
决定注册哪些函数。

## 沙箱与安全

- 用 `Engine::new_raw()`（不注册任何 print/debug/语句），只手动注册白名单。
- 关闭文件读写/网络（除非显式注册 `fs.*`）。
- 设置 `max_expr_depth`/`max_call_levels`/`max_operations`，防死循环。
- 脚本超时：`Engine::run_with_scope` 配合操作上限；模块层再加整体超时。
- 输出走 `module_main` 的 `output` 缓冲区，不碰 stdout。

## 实现位置

- `agent-rs/modules/script/`（新 crate，`cdylib`）
  - `src/lib.rs` — `module_name` / `module_main`
  - `src/engine.rs` — 按平台+features 构造 Rhai Engine
  - `src/ifdef.rs` — `#if` 自定义语法解析
  - `src/platform/windows.rs` / `platform/linux.rs` — 平台函数注册
- `libra-engine/src/engine/dispatcher.rs` — `plugin.exec` 分支按 `kind` 分流
- workspace `Cargo.toml` — 加入 `modules/script`

## 实现状态（已落地）

- ✅ `agent-rs/modules/script/` crate：`module_name` / `module_main` + Rhai 引擎
- ✅ `ifdef.rs`：`#if(WINDOWS)/#elif(LINUX)/#else/#endif` 文本预处理器（4 个单测通过）
- ✅ 平台 API 门控：`platform_windows.rs`（`cmd`/`powershell`/`reg_query`/`reg_set`）
  与 `platform_linux.rs`（`shell`/`bash`/`uname`/`ip_route`），按 `cfg(target_os)` 互斥
- ✅ `full` feature 钩子（winapi/syscall）**故意留空**——不做通用 FFI 逃生舱，
  深度 API 需逐项白名单审查后扩展
- ✅ dispatcher `plugin.exec` 支持 `kind: script|native`
- ✅ 服务端 `PluginModuleRef` 加 `Kind`/`Entry`，`PluginActionController` 读脚本源码下发
- ✅ `BuilderBuildService.CloudModules` 加入 `("script", "script_module")`
- ✅ 示例：`examples/soft-recon/`（脚本）+ `examples/soft-recon-native/`（编译）

说明：条件编译最终采用**文本预处理器**（`ifdef.rs`）而非 Rhai `register_custom_syntax`，
因为 C# 的 `#if` 本质就是预处理指令（解析前裁剪），文本预处理器语义最忠实、也
更好测试、且不引入 Rhai 解析期语法扩展的脆弱性。

