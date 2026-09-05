# Libra Desktop(Electron 壳,位于 main)

桌面壳/启动器(Electron),把 Libra-Nextgen 的 Server + Console 以"跨平台桌面 App"
形态分发。代码与 Server / Console / Agent 同在 `main`(单分支工作流);
发布产物由 tag 触发的 CI 统一发布到 GitHub Releases。

> WPF 壳已于桌面化改造时移除(见 `docs/desktop-electron-architecture.md` §9 清理清单)。

## 目录结构

desktop/
  electron/             Electron 壳源码(CommonJS,electron ^44)
    main.js             app 生命周期 / 本地 service 启动 / 托盘 / IPC
    serviceProcess.js   后端进程管理(spawn/探测/接管/回收)
    updater.js          GitHub 更新(service 手动 / web 静默 / agent 模板)
    preload.js          window.libraDesktop 桥
    boot.html           加载失败兜底页
    README.md           壳内文档与联调待办

## Release 资产矩阵(tag 触发;见 .github/workflows/release-assets.yml 与 templates.yml)

| 资产 | 内容 | 消费方 |
|---|---|---|
| libra-desktop-{rid}-{tag}.zip | 每平台载荷:自包含 Server + console(web/)+ version.json | Electron Check Update(手动确认) |
| libra-webapp-{tag}.zip | Console 静态产物(纯前端) | 静默 web 更新 / 裸机部署 |
| libra-service-{rid}-{tag}.zip | 自包含后端(无前端) | 纯云部署 |
| libra-agent-tpl-{platform}-{tag}.zip | Agent 载荷模板 | 桌面 Builder 种子/刷新 + 云端 template 模式 |

rid = win-x64 / win-arm64 / linux-x64 / linux-arm64(mac 列入 v1.1)。所有 zip 均有
同名 .sha256 伴生资产;壳对载荷强制校验 SHA-256,缺失即拒绝。
Electron 安装包(win nsis / linux AppImage)由 electron-builder 产出(CI 接线为 TODO)。

## 设计摘要

- **跨平台**:Electron(win/linux/mac)× 架构;本地模式随包 spawn .NET Server
  (自包含,读用户目录 libra.conf.json 决定 SQLite/Mongo 与回退),远程模式连已部署 Server;
- **界面即网页**:窗口加载本地 service 托管的 console(同源),console 检测桌面 UA 后
  渲染透明顶栏与窗口控制(既有机制);
- **数据存储**:Server 同一二进制双存储(SQLite/Mongo),见
  `docs/desktop-electron-architecture.md` §3-§5;
- **更新**:壳不自更新;service 载荷手动 Check Update(GitHub Release,sha256 强校验,
  latest/.prev 原子换版回滚),web 静默刷新失败回退内嵌基线,agent 模板同 tag 刷新。

## 运行时文件布局(userData,随 OS 而定)

libra.conf.json      存储/监听配置(壳唯一写者,service 启动读)
data/libra.db         SQLite 数据文件(默认)
payload/latest|.prev/ 当前/上一版载荷(version.json + 后端 + web/)
downloads/            下载缓存
templates/            agent 模板缓存
web/                  静默更新的 console 产物(失败回退内嵌基线)

## 本地开发

# 壳(dev/demo 模式,无 payload 时加载 5173 dev server)
cd desktop/electron && npm install && npm start

# 发布
dotnet publish src/LibraNextgen.Server/LibraNextgen.Server.csproj \
  -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o stage
# 将 stage + src/console/dist 按 version.json 契约放入 userData/payload/latest 后启动壳

权威设计文档:`docs/desktop-electron-architecture.md`;壳内 TODO 见 `desktop/electron/README.md`。
