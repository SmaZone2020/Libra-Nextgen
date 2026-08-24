# 插件包说明（com.example.plugin-sdk）

这是一个可直接导入 Libra-Nextgen 的插件包（zip）。

## 目录结构

```
com.example.plugin-sdk/
├── meta.json              # 插件契约（必需）
├── module/                # Agent 端模块（脚本通道）
│   └── plugin_sdk.rhai    # Rhai 脚本，含 #if 多平台写法 + 全部平台 API
└── page/                  # 前端页面源码（分发用）
    └── index.tsx          # HeroUI "活文档"页
```

## 导入

1. 控制台 → 插件管理页 → 导入，选择本 zip。
2. 启用后，`module/plugin_sdk.rhai` 会随动作下发到 Agent 内存执行。

## 前端页面（重要）

`page/index.tsx` 是**源码分发**——当前实现下前端是 Vite 构建产物，无法在
运行时编译 `.tsx`。要让它生效，需把 `page/index.tsx` 放进前端仓库：

```
src/webapp/src/plugins/com.example.plugin-sdk/index.tsx
```

并重新构建前端（`import.meta.glob` 会在构建期收集它）。仓库里已经带了这个
页面文件，所以仓库内联构建时本插件的前端页自动生效。
