# Libra Desktop — Electron shell (P3 first cut)

本地优先的 Electron 桌面壳:spawn 随包的 .NET Service(双存储,读用户目录
`libra.conf.json`),加载 Console;手动 Check Update 拉 GitHub Release 载荷,
web 静默更新失败回退内嵌基线;托盘;远程模式(console 内切换 origin)。
架构与更新契约见 `docs/desktop-electron-architecture.md` §2/§3/§7/§8。

## 文件

| 文件 | 职责 | 移植自(WPF) |
|---|---|---|
| `main.js` | app 生命周期、本地 service 启动、托盘、更新/存储配置 IPC、窗口 | `App.xaml.cs`/`MainWindow.xaml.cs` |
| `serviceProcess.js` | spawn 后端(`--user-data-dir`)、存活探测、外部接管、退出回收 | `Core/BackendProcess.cs` |
| `updater.js` | GitHub 最新 tag、per-RID `libra-desktop-{rid}-{tag}.zip` 下载 + SHA-256 强校验、`latest/.prev` 原子换版回滚、静默 web、agent 模板缓存 | `Core/GitHubUpdater.cs`/`PayloadManager.cs` |
| `preload.js` | `window.libraDesktop` 桥(窗口控制 + checkUpdate/openDataDir/setStorageConfig/restartService/getAppInfo) | `preload`(demo 原型) |
| `boot.html` | 加载失败兜底页 | demo 原型 |

## 运行

```bash
npm install          # electron ^44 + extract-zip
npm start            # 无 payload 时走 dev/demo 模式(LIBRA_CONSOLE_URL 或 5173)
```

有 payload 时(userData/payload/latest/version.json)自动启动本地 service 并加载
`http://127.0.0.1:{port}/`;托盘 Quit 回收自拉起的后端。

## 待办(联调前)

- [x] baseline-service/baseline-web 装入 extraResources,壳在无 userData 载荷时自动以
      baseline 起本地后端(LIBRA_WEB_ROOT 指向内嵌 web);
- [ ] GUI 全流程冒烟(壳 → 本地服务 → console → 存储切换)——安装包验证;
- [ ] console 侧 desktop-only 存储设置段与 /api/system/storage 回退横幅 UI(已在 console 侧完成,待壳内联调);
- [ ] 签名/公证策略(见架构文档 §11)。
