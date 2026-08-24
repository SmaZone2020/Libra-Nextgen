# 示例插件

这里提供两个对照示例，展示 Agent 端模块的**两条通道**：

## 1. `soft-recon/` — 脚本通道（推荐，无需编译）

- `meta.json` 里 `module.kind = "script"`。
- `module/soft_recon.rhai` 是 Rhai 脚本，内含 `#if(WINDOWS)/#elif(LINUX)/#else/#endif`
  条件编译，且 Windows 用 `cmd()`、Linux 用 `shell()`（平台 API 门控）。
- 作者无需 Rust 工具链，改脚本即可下发。

## 2. `soft-recon-native/` — 编译通道（逃生舱，性能/深度系统调用）

- `meta.json` 里 `module.kind = "native"`。
- `module/soft_recon.rs` 是编译为 `cdylib` 的 Rust 源码，导出 `module_name` /
  `module_main`（符合 `libra-load` ABI）。C/C++ 同理（只要导出同样的 C ABI）。
- 用于需要极致性能、免杀特征控制、或直接调 Win32/内核的场景。

## 打包

插件包（zip/7z/rar）内必须有 `meta.json`；`module/` 放脚本（`.rhai`）或
编译产物（`.dll`/`.so`，按 `x64`/`x86`/`linux-x64` 分目录）。前端页面见
`src/webapp/src/plugins/com.example.soft-recon/index.tsx`。
