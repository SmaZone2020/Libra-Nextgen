# 插件体系(Plugin System)

> 本文档是插件体系的**架构说明**,不是插件包本身。可安装的插件源码与市场仓库见 [Libra-Plugins](https://github.com/SmaZone2020/Libra-Plugins)(独立仓库,本仓库不跟踪其 checkout)。

## 1. 仓库边界(硬性约束)

| 路径 | 内容 | 是否入库 |
|---|---|---|
| `Libra-Plugins/`(独立仓库) | 插件源码:`meta.json` + `module/` + `service/` + `page/` + `assets/` | 独立 git 仓库 |
| `src/plugins/` | 服务器**运行时安装目录**(zip 导入/解压目标) | ❌ gitignore |
| `src/service/plugins-service/` | 服务端脚本开发回退目录 | ❌ gitignore |
| `src/webapp/src/plugins/` | 控制台运行时加载器(registry/host/loader/icons)——不含任何插件页面 | ✅ |

**已安装插件目录及其相关文件一律不允许进入 git 仓库。** 插件只能通过 zip 导入或安装脚本落地到运行时目录;插件源码的增删改一律发生在 Libra-Plugins 仓库。

## 2. 前端渲染架构(运行时加载,dev/preview 一致)

控制台**不把插件页面编译进 bundle**。`src/webapp/src/plugins/registry.ts` 启动时:

1. `GET /api/plugins/manager/manifests`(启用清单)→
2. 对每个带 `entry` 的插件 `GET /api/plugins/{id}/page/manifest.json` →
3. 按 `kind` 渲染:

- **`kind: "react"`** — 插件在打包时把 `page/index.tsx` 编译成 `page/dist/index.js`(IIFE bundle,React/HeroUI/图标/`usePluginHost` 全部 external 到 `window.LibraPluginHost`)。控制台以 `<script>` 注入,取 `window.__libraPluginRegistry[pluginId]` 的 default 导出,in-host 渲染。
- **`kind: "html"`** — 插件直接提供 `page/index.html` + 自己的 js/css。控制台以 iframe 加载,插件页面通过 `page/_bridge.js`(postMessage RPC)拿到与 React 插件一致的 `usePluginHost()` API(选 Agent、`dispatchTask`、`subscribeOutput`)。

**效果**:新增/更新插件只需要服务器上出现新文件——`npm run dev` 与 `npm run preview` 都无需重建控制台,导入插件后刷新页面即生效。页面资源端点与 `assets/` 一致匿名可读(页面不含敏感数据,数据全部走带 token 的业务 API)。

## 3. 插件页面形态与打包

- **TSX 形态**:`page/index.tsx`(default export 组件)。打包脚本 `pack.mjs` 内置 esbuild,产出 `page/dist/index.js`,依赖映射:

  | 插件源码 import | 运行时来源 |
  |---|---|
  | `react` / `react-dom` | `window.LibraPluginHost.React / ReactDOM` |
  | `@heroui/react` | `window.LibraPluginHost.HeroUI` |
  | `@gravity-ui/icons` | `window.LibraPluginHost.Icons`(白名单) |
  | `react-i18next` | `window.LibraPluginHost.useTranslation` |
  | `../hooks/usePluginHost` | `window.LibraPluginHost.usePluginHost` |

- **HTML 形态**:`page/index.html` + `index.js/css`,原样打包;页面内 `<script src="_bridge.js"></script>` 引入桥。

## 4. 开发 / 安装流程

```bash
# 插件仓库内:打包(自动编译 TSX 页面)
node pack.mjs          # → dist/<pluginId>-<version>.zip

# 控制台导入(Web UI 插件管理页,或)
# curl -F file=@plugin.zip http://127.0.0.1:5270/api/plugins/manager/import

# 开发环境一键安装全部内置插件(从本地 Libra-Plugins checkout 构建安装)
node scripts/install-builtin-plugins.mjs
```

安装后**刷新控制台页面**即可看到插件入口,无需重建前端。

## 5. 相关文档

- 插件开发模板:`Libra-Plugin-Template/`(独立仓库 checkout,含 meta/agent/service/page/pack)
- 市场索引:`Libra-Plugins/index.json` + `build-index.ps1`
