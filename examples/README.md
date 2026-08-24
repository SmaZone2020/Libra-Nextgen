# 示例插件

这里提供可导入 Libra-Nextgen 的示例插件，同时作为开发参考。每个目录都是一个
可直接打包成 zip 的插件包（`meta.json` 必须在包根目录）。

## 1. `plugin-sdk/` — 插件开发 SDK 教程（推荐先读）

- **完整开发教程**：`plugin-sdk/README.md` 详细讲解 meta.json 编写、插件三层结构、
  script/native 两条模块通道、前端页面接入、静态资源与开发避坑清单。
- `module/plugin_sdk.rhai` 是 Rhai 脚本，含 `#if(WINDOWS)/#elif(LINUX)/#else/#endif`
  条件编译，展示全部平台 API。
- `page/index.tsx` 是前端"活文档"页，展示 `usePluginHost()` 宿主 API 与 HeroUI 组件。

## 2. `qqkey/` — native 通道示例（QQ ClientKey 探测）

- `meta.json` 里 `module.kind = "native"`，`module.name = "qqkey"`。
- `module/x64/qqkey.dll` 是编译为 `cdylib` 的 Rust 产物（源码在
  `src/agent-rs/plugins/qqkey/`），导出 `module_name` / `module_main`（符合
  `libra-load` ABI）。
- 用于需要极致性能、免杀特征控制或直接调底层系统 API 的场景。

## 3. `aitoken/` — native + 静态资源示例（AI API Key 探测）

- `meta.json` 里 `module.kind = "native"`。
- `assets/` 打包了厂商图标，前端经 `/api/plugins/com.libra.aitoken/assets/<文件>`
  加载，演示插件如何携带静态资源。
- `page/index.tsx` 演示 Accordion 分组 + 图标 + 明文/掩码切换。

## 打包

- 插件包（zip）根目录必须有 `meta.json`；`module/` 放脚本（`.rhai`）或编译产物
  （`.dll`/`.so`，按 `x64`/`x86`/`linux-x64` 分目录）；`page/` 放前端页面源码；
  `assets/` 放静态资源。
- 前端页面是 Vite 构建期产物：需放到 `src/webapp/src/plugins/<pluginId>/index.tsx`
  并重建前端（`import.meta.glob` 在构建期收集）。

## 导入

- 控制台 → 插件管理 → **上传插件**（选 zip），或 **从 Git 导入**（填 git 链接，以仓库名为 pluginId）。
- 详细教程见 `plugin-sdk/README.md`。
