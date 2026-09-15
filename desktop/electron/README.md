# Libra Desktop — Electron shell (P3 first cut)

本地优先的 Electron 桌面壳:spawn 随包的 .NET Service(双存储,读用户目录
`libra.conf.json`),加载 Console;手动 Check Update 拉 GitHub Release 载荷,
web 静默更新失败回退内嵌基线;托盘;远程模式(首启向导写入,托盘可切回本地)。
架构与更新契约见 `docs/desktop-electron-architecture.md` §2/§3/§7/§8。

## 文件

| 文件 | 职责 | 移植自(WPF) |
|---|---|---|
| `main.js` | app 生命周期、本地 service 启动、首启向导编排、托盘、更新/存储配置 IPC、窗口 | `App.xaml.cs`/`MainWindow.xaml.cs` |
| `serviceProcess.js` | spawn 后端(`--user-data-dir`)、存活探测、外部接管、退出回收 | `Core/BackendProcess.cs` |
| `storageProbe.js` | 存储连通性探测(服务端 `LIBRA_STORAGE_PROBE` 强探测 + 纯 TCP 弱回退) | — |
| `updater.js` | GitHub 最新 tag、per-RID `libra-desktop-{rid}-{tag}.zip` 下载 + SHA-256 强校验、`latest/.prev` 原子换版回滚、静默 web、agent 模板缓存 | `Core/GitHubUpdater.cs`/`PayloadManager.cs` |
| `preload.js` | `window.libraDesktop` 桥(窗口控制 + checkUpdate/openDataDir/setStorageConfig/restartService/getAppInfo + 首启向导四个方法) | `preload`(demo 原型) |
| `boot.html` | 加载失败兜底页 | demo 原型 |
| `setup.html` | 首启存储向导页(SQLite / MongoDB / 远程服务器) | demo 原型 |
| `smoke-service.js` | 壳↔服务冒烟(dev 工具,走 `serviceProcess.js`) | — |
| `smoke-setup.js` | 向导纯函数 + 探测契约冒烟(dev 工具,无需 GUI/Electron) | — |

## 运行

```bash
npm install          # electron ^44 + extract-zip
npm start            # 无 payload 时走 dev/demo 模式(LIBRA_CONSOLE_URL 或 5173)
node smoke-setup.js  # 向导辅助函数 + 探测契约自检(可加 LIBRA_PROBE_BIN 跑真二进制)
```

有 payload 时(userData/payload/latest/version.json)自动启动本地 service 并加载
`http://127.0.0.1:{port}/`;托盘 Quit 回收自拉起的后端。

## 首启存储向导(setup.html)

`app.whenReady` 的路由顺序:

1. **`shell-state.json` 记录远程入口**(`entry: "remote"`)→ 直接加载该 URL,
   不起本地服务、不显示向导;
2. **`libra.conf.json` 存在** → 原行为不变:读 `closeBehavior` → 载入 payload/baseline
   → 开窗 → 起本地服务 → 载入 Console;
3. **两者都没有** → **不启动本地服务**,窗口只显示向导(纯 `file://` 页面,
   不接 `did-fail-load` 的 dev-URL 重试,也不会被自动跳走)。

三个选项:

| 选项 | 交互 | 落盘 |
|---|---|---|
| SQLite(推荐) | 一键「使用 SQLite 继续」 | `storage.mode = "sqlite"`,空 connectString/dbPath |
| MongoDB | 必填连接串(客户端前缀校验)+[测试连接];**测试成功前[下一步]禁用**,失败显示具体错误并保持禁用 | `storage.mode = "mongo"`,`connectString` = 实测通过的那一串 |
| 连接远程服务器 | 填服务器地址 +[测试连接];成功后**不起本地服务** | `storage.mode = "sqlite"`(保证日后本地启动可用)+ 远程 URL 记入 `shell-state.json` |

- 写入顺序固定为「先原子写 config(temp+rename),再启动/跳转」:中断的选择不会留下
  "服务在跑但 config 没写" 的半初始化状态;两份 config 都满足架构文档 §3 契约
  (`schemaVersion: 1` / `storage` / `listener: {port:5270, bindLoopback:true}`),
  已存在的 `listener`/`desktop` 段保留(向导只决定 `storage`);
- 关闭向导窗口 = 直接退出(不缩托盘、不写任何文件),下次启动仍显示向导;
- 远程入口的回退路径:托盘 **Use Local Service** → 清除 `shell-state.json` 里的远程记录
  (写 `entry: "local"`)→ 停本地服务 → 按 config 起本地服务并加载 `127.0.0.1`。
  该菜单项仅在存在远程记录时出现;
- 远程 / MongoDB 的「测试连接」语义见下。

**状态机(向导页,每个卡片一格)**:`idle → ready(输入合法) → testing → ok | failed`;
只有 `ok` 才解禁[下一步],输入一变即回落到 `ready` 并重新禁用(测试过的值 ≠ 当前值
不允许提交)。SQLite 卡片无中间态,点击即提交。

## 连接测试

- **存储(MongoDB)**:主进程 spawn 服务二进制并带 `LIBRA_STORAGE_PROBE=1` +
  `--user-data-dir <dir> --store mongo --connect <串>`,读它输出的单行 JSON
  (`{reachable,requested,effective,error}`),20s 超时即杀子进程。二进制解析顺序与
  起服务一致:`loadPayloadManifest()` → `loadBaselinePayload()`;
  **开发回退**(无二进制:裸源码检出):退化为对连接串 host:port 的纯 TCP 连接,
  结果**明确标注**「仅检测到端口可达(开发模式)」,绝不冒充强探测。`mongodb+srv://`
  在回退路径下不猜测端口,直接报「无法解析 SRV 记录」;老版本服务(无探测模式)
  输出不出 JSON 行时同样回落弱探测。
- **远程服务器**:`GET <url>/api/auth/status`,沿用 console 的存活约定
  (200/401/500 = 有 Libra 后端在跑;`serviceProcess.isAlive` 同源);
  其它状态码按"非 Libra 接口"报错,顺带看响应体是否像网页。地址会归一化为 origin
  (无 scheme 补 `http://`,路径/锚点丢弃)。

## 测试钩子

- `LIBRA_USER_DATA_DIR`:钉住用户数据目录(向导/配置/载荷全在此);
- `LIBRA_SMOKE_EXIT_MS`:到点自动退出,**首启向导路径同样生效**(向导窗口也走
  `scheduleSmokeExit()`),headless 冒烟不会卡在向导页;
- 复位首启状态:删掉 `<userData>/libra.conf.json`(若还用远程入口,一并删
  `<userData>/shell-state.json`),下次启动即回到向导。

## 待办(联调前)

- [x] baseline-service/baseline-web 装入 extraResources,壳在无 userData 载荷时自动以
      baseline 起本地后端(LIBRA_WEB_ROOT 指向内嵌 web);
- [x] 首启存储向导(三选一 + 连接测试 + 远程入口 + 托盘切回),替换原先"静默写默认
      sqlite config"的补丁;
- [ ] GUI 全流程冒烟(壳 → 本地服务 → console → 存储切换)——安装包验证;
- [ ] console 侧 desktop-only 存储设置段与 /api/system/storage 回退横幅 UI(已在 console 侧完成,待壳内联调);
- [ ] 签名/公证策略(见架构文档 §11)。

## 已知边界

- 向导把 `listener.port` 写成 5270;服务端即使 payload manifest 里写了别的端口,
  也以 config 的 listener 段为准(服务端行为,非壳改动)。manifest 与 config 端口
  不一致时,壳的端口探测会与后端实际监听端口错位——发布载荷需保证两者一致。
- `mongodb+srv://` 在无服务端二进制时无法验证(弱回退不解析 SRV);
- 服务端探测模式(见架构文档)未发布前,向导一律走弱回退并如实标注。
