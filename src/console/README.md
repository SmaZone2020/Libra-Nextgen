# Libra-Console(前端控制台)

Libra-Nextgen 的 Web 控制台:React 19 + Vite + HeroUI3Pro + Tailwind CSS v4 + TypeScript。
多人协同、实时审计的 C2 操作界面。

## 快速启动

```bash
npm install          # 安装依赖
npm run dev          # 开发服务器(http://localhost:5173)
npm run build        # 生产构建(tsc -b && vite build)
npm run preview      # 预览构建产物(http://localhost:4173)
npm run typecheck    # TypeScript 类型检查
npm test             # 单元测试(vitest)
```

后端(端口 5270)需先启动,见 [部署手册](../docs/deployment.md)。

## 目录结构(真实)

```
src/
├── main.tsx                 # 应用入口(ErrorBoundary + Toast.Provider + App)
├── app/App.tsx              # 根组件:侧边栏 + 路由 + 过渡动画 + 插件分组
├── api/                     # 后端 API 客户端(client.ts 带 JWT + 插件/代理/文件等)
├── pages/                   # 页面
│   ├── Dashboard/           #   仪表盘
│   ├── Agents/              #   Agent 列表
│   ├── Shell/               #   交互式终端(xterm.js)
│   ├── FileManager/         #   文件管理
│   ├── SoftwareData/        #   软件数据(SSH/RDP/Token)
│   ├── Proxy/               #   代理/内网浏览
│   ├── Builder/             #   在线载荷构建
│   ├── Ai/                  #   AI 助手 Justitia
│   ├── Settings/            #   系统设置/风险策略
│   ├── Plugins/             #   插件管理/市场
│   └── ...                  #   审计/系统/关于
├── components/              # HeroUI3Pro 组件与业务组件
├── contexts/                # 全局状态(Agent 选择等)
├── hooks/                   # usePluginHost 等业务 hooks
├── ws/consoleWs.ts          # 控制台 WebSocket(/ws/console,实时推送)
├── plugins/                 # 插件页面运行时加载器(见下)
└── styles/                  # Tailwind v4 + 主题
```

## 插件页面(运行时加载,无需重建)

本仓库**不包含任何插件页面源码**。插件页面是纯 HTML+JS+CSS,由服务器在运行时提供
(已安装插件走后端 API):

- 清单:`GET /api/plugins/manager/manifests`(后端)
- 页面:`GET /api/plugins/{id}/page/manifest.json` → `kind: html`,控制台拉取
  `page/index.html` 后向 `<head>` 注入 `<base>` + SDK,以 sandbox iframe(srcdoc)
  渲染;插件直接使用注入的 `window.Libra`(usePluginHost / api / getApiOrigin),
  无需引用任何 SDK 文件
- 资源:`GET /api/plugins/{id}/assets/**`(后端)

`src/plugins/` 目录只包含加载器本身:

| 文件 | 职责 |
|---|---|
| `registry.ts` | 运行时注册:拉清单 → 探测页面 manifest → 组装路由/侧边栏 |
| `loader.tsx` | fetch 插件 HTML → 注入 `<base>`+SDK → sandbox srcdoc iframe;postMessage 桥(选中设备/任务下发/WS 推送/带 JWT 的 API 转发) |
| `icons.ts` | 图标白名单(侧边栏/路由图标,按 meta.json entry.icon 映射) |

`npm run dev` 与 `npm run preview` 行为一致:插件导入到服务器运行时目录后,
刷新页面即生效,控制台无需重新构建。详见 `docs/plugins/README.md` 与
`docs/plugins/html-plugin-sdk.md`。

## 与后端连接

- API 基址解析优先级:`VITE_API_BASE`(构建时)→ 页面 Host 推导(5270)→ 默认
  `http://127.0.0.1:5270`(见 `src/api/client.ts`)。
- 鉴权:Bearer JWT(localStorage `token`),401 自动触发重新登录。
- 实时:WebSocket `ws://<origin>/ws/console?token=…`。
