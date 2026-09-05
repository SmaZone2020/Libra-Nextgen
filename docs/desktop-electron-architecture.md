# Libra Desktop — Electron 桌面化架构总纲(定稿)

> 状态:决策已收敛,按 P0→P4 分阶段实施。本文档是桌面化的**权威设计文档**;
> 与 `CLAUDE.md` 第 1 节(桌面壳描述)与 `desktop/README.md` 在此方案落地后同步。
> 结论速览:同一 .NET 二进制双存储(Mongo/SQLite),Electron 壳负责进程与更新,web 控制台零 UI 改动。

## 1. 目标与决策摘要

把 Libra-Nextgen 从"云上 C2"扩展出一个**本地优先的 Electron 桌面应用**,同时保留云端部署形态。

| 项 | 决定 |
|---|---|
| 桌面形态 | Electron 壳 + .NET 10 自包含 Service(sidecar,spawn 子进程)+ web 控制台(React SPA 不变) |
| 存储 | **SQLite 完全支持**(核心域与 AI/MCP/IM 全功能平权);Mongo 模式保持现状;同一二进制,`libra.conf.json` 互斥切换,互不干扰 |
| 平台(v1) | **win-x64、win-arm64、linux-x64、linux-arm64**;mac 不做(v1.1 再看,agent 模板 mac-arm64 已在 CI 出) |
| 运行模式 | 本地模式(默认,SQLite)+ 远程模式(连已部署 Server,console 现成 origin 切换);存储可在设置中切换,重启生效 |
| 更新 | 手动 Check Update(用户确认)拉 GitHub service/agent 模板;web **静默**更新,失败回退 Electron 内嵌基线 |
| 技术约束 | **不用 AOT**(Roslyn 脚本运行时编译 + MongoDB.Driver 与之冲突);自包含 JIT 单文件,全功能零裁剪 |
| 后端运行时 | 不装 .NET Runtime、不装数据库;bundle 自带 |
| 遗留清理 | 删除 WPF 壳(`desktop/LibraDesktop/`)与 `libra-shell-win-x64` 发布资产 |

## 2. 总体架构

```
┌─ Libra Desktop (Electron 安装包:win/linux × x64/arm64)──────────────┐
│ BrowserWindow ──http://127.0.0.1:<port>──▶ 本地 Service(.NET,sidecar) │
│   (preload 注入 window.DesktopBridge:checkUpdate/版本/数据目录/退出)    │
│   │                                                                   │
│   ├─ 主进程 ServiceProcessManager:spawn/端口存活探测/接管/退出回收      │
│   ├─ 主进程 PayloadManager:下载 → SHA-256 → 原子换版(latest/.prev 回滚)│
│   ├─ 主进程 Updater:service 手动 / web 静默(同 tag,校验失败保旧)       │
│   ├─ 主进程 Tray:Check Update / Open Remote Entry / 数据目录 / Quit    │
│   └─ resources/ 内嵌基线:baseline-service + baseline-web(兜底)         │
└───────────────────────────────────────────────────────────────────────┘
            │ spawn:--user-data-dir <userData> --port …(其余读 config)
            ▼
Service(ASP.NET Core .NET 10,一个二进制两种形态)
  ├─ Mongo 模式:云端/团队部署,行为与今天完全一致(appsettings/env)
  ├─ SQLite 模式:桌面默认,数据在用户目录(libra.conf.json 指定)
  └─ 进程内静态托管 web/(LIBRA_WEB_ROOT 既有机制,直接复用)
```

**载荷目录一律在用户数据目录**(Electron `userData`),**不进安装目录**:
- 写入不需管理员权限;macOS 写 .app / Linux 写 AppImage 会破坏签名/不可写;
- Windows `%APPDATA%/LibraDesktop`、Linux `~/.config/LibraDesktop`、mac `~/Library/Application Support/LibraDesktop`;
- 布局:`libra.conf.json`、`data/libra.db`、`payload/latest|.prev/`(service+web+version.json)、`downloads/`、`templates/`(agent 模板缓存)、`logs/`。

## 3. 用户配置契约(libra.conf.json)

**Electron 唯一写者**(设置页切换 → 原子写:temp + rename → 重启 service);service 启动先读、只读。云部署无此文件 → 行为与今天完全一致(零影响)。

```json
{
  "schemaVersion": 1,
  "storage": {
    "mode": "sqlite",
    "connectString": "",
    "dbPath": "",
    "fallback": true
  },
  "listener": { "port": 5270, "bindLoopback": true }
}
```

- `mode`: `sqlite|mongo`;`dbPath` 空默认 `<userData>/data/libra.db`;**mongo 模式也持有 sqlite 文件**(回退底座);
- `fallback`: mongo 启动连不上时 true→回退 sqlite 继续服务;false→带错误码退出由 UI 呈现;
- 路径发现优先级:CLI `--user-data-dir` > env `LIBRA_USER_DATA_DIR` > 各 OS 应用数据默认目录(`LibraDesktop` 子目录);
- 配置优先级(高→低):CLI 参数(`--store/--connect/--dbpath/--user-data-dir`,调试/便携)> config 文件 > env > appsettings。云部署 = 后两级,桌面 = 前两级;
- 实现:`src/LibraNextgen.Server/Configuration/UserConfig.cs`(`UserConfigLoader.TryLoad`,解析失败/未知 schemaVersion 一律回默认,绝不阻止启动);
- `connectString` 可能含凭据,明文存放;Windows 后续可用 DPAPI 加密该字段(P1 后评估),先文档注明目录权限(chmod 600 / ACL);
- 壳自身 UI 状态(上次入口 URL、GitHub 源等)**不写本文件**,放壳的独立状态文件——壳状态 ≠ 服务契约。

**Service 启动顺序**:

```
读 config(缺省/非法 → 全默认 sqlite,绝不崩)
  → requested store
  → mongo? 启动探测(MongoClient ping,~5s)
       ├─ 通 → effective=mongo
       ├─ 不通 + fallback → effective=sqlite(日志 + /api/system/storage 暴露 fallbackReason=mongo_unreachable)
       └─ 不通 + 无 fallback → 错误码退出
  → sqlite → 直接跑
```

**状态端点**:`GET /api/system/storage`(鉴权内)返回 `{ requested, effective, fallbackReason, dbType }`;console 横幅与 Electron 通知共用。

**边界(产品行为,已接受)**:切换存储 = **重启生效**(无进程内热切换);sqlite↔mongo **数据不自动迁移**(export/import 为后续独立功能);回退只发生在**启动时刻**,运行中 mongo 断连不倒回(避免数据去向漂移),用户手动"重试连接"。

## 4. Service 改造

### 4.1 存储抽象(核心工程)

- 现状:`Repository<T>`(Mongo 类型签名)+ 9 个服务直持 `MongoDbContext`(AI/IM/MCP 域)。
- 新契约 `IStore<T>`(`src/LibraNextgen.Server/Data/IStore.cs`):
  - 过滤 = `Expression<Func<T,bool>>`(Mongo 驱动可翻译子集;SQLite 本地小数据内存求值);
  - 更新 = **字段级赋值** `FieldUpdate(Field, Value)`——代码审计确认全部更新均为 `.Set`(43 处,零 $inc/$push/$pull),接口因此只暴露 `UpdateByIdAsync/UpdateOneAsync(fields)`;
  - 排序 = `(sortField, sortDescending)`,空则默认(Mongo `_id` desc / SQLite 插入序);
  - 分页/计数/存在性/插入/删除与现有用法一一对应。
- Mongo 适配:`Repository<T>` 实现 `IStore<T>`(新方法薄适配既有 Mongo 类型方法,**共享同一 collection,零行为变化**;字段字符串经驱动 class map 翻译,`Id`→`_id` 语义与既有 `Eq("Id")` 一致)。
- SQLite 适配(P1 起):`SqliteStore<T>` 文档式 JSON 列存储(见 §5)。
- 迁移节奏:**每个 collection 一组**迁到 `IStore<T>`(P1 核心域,P2 AI/MCP/IM),随 SqliteStore 落地同步切换,避免半成品状态。

### 4.2 SQLite 专属机制替代(审计确认)

- Traffic 7 天 TTL(`MongoIndexBuilder` 的 `ExpireAfter`)、AiChannelBindCode 过期 → sqlite 模式注册**后台清理 HostedService**;
- `users.Username` 唯一、ai 频道 partial unique(对应 Mongo `PartialFilterExpression`)→ 提取列 + SQLite `UNIQUE` / partial index(`WHERE col IS NOT NULL` 原生支持);
- 热路径索引(agents `(Status,LastSeen)`、tasks `(AgentId,Status,CreatedAt)` 等)→ 提取列普通索引;单机数据量小,复杂过滤可内存兜底。

### 4.3 不变项

HTTP/SSE/WS API 契约、JWT/RBAC、agent beacon 加密协议(RSA+AES-GCM+malleable)、Roslyn 插件脚本、Builder、静态 web 托管——全部原样,双存储只动数据访问层。

## 5. 数据存储设计(SQLite)

- 技术:**Microsoft.Data.Sqlite**(自带 e_sqlite3,无 EF),WAL + busy_timeout,单写者够用;
- 形态:**每 collection 一表** `{name}(_id TEXT PRIMARY KEY, doc TEXT NOT NULL, <提取列>…)`,`doc` 存整条模型 JSON(System.Text.Json,属性名原样);
- 关键事实:全仓库模型 **零 ObjectId / 零 [BsonId]**,Id 全是 string → 直接做主键,契约干净;
- 迁移:`PRAGMA user_version` 版本化;
- "互不干扰":两种存储互斥存在、不互相读写,由 config `mode` 保证;两套实现共享同一 `IStore<T>` 契约。

## 6. Webapp(几乎零改动)

- React 19 SPA 与云端**共用同一份代码与产物**,无 UI 改动;远程模式 = 运行时 origin 切换(既有能力);
- 新增(desktop-only,检测 `window.DesktopBridge` 存在才渲染,浏览器/云部署自动隐藏):
  1. **存储设置段**:SQLite/Mongo 单选 + 连接串 + [测试连接](Electron 主进程 MongoClient ping 预检)+ [应用](写入 config → 重启 service → console 自动重连);
  2. **回退横幅**:`/api/system/storage` 显示 `effective != requested` 时提示"MongoDB 连接失败,当前运行于 SQLite 单机模式(数据未迁移)"+ 重试连接按钮;
  3. Check Update 入口、数据目录入口、版本显示。
- 更新通道:web 产物随每个 release 出 `libra-webapp-{tag}.zip`;Electron 静默下载校验后写 `userData/web`(目录原子换名,无需重启 service);失败/缺失 → `LIBRA_WEB_ROOT` 指向内嵌 baseline-web。

## 7. Electron 壳

- 工程落点(建议):`desktop/electron/`(TypeScript,electron-builder),与 .NET sidecar 同仓;
- 职责:spawn/探测/接管本地 service(沿用现 BackendProcess 语义:已活端口 → External 接管不重复拉起)、PayloadManager(SHA-256 强制,校验失败拒绝并保留旧版)、Updater、托盘、远程模式、存储切换编排;
- 更新流:
  1. **service**:用户点 Check Update → 查 GitHub Releases 最新 tag → 与本机 version.json 比对 → 下载本平台 `libra-desktop-{rid}-{tag}.zip`(service+web+version.json)→ 校验 → 停旧 service → 原子换入 `payload/latest`(旧版移入 `.prev`)→ 重启;启动探测失败自动回滚 `.prev`;
  2. **web**:静默(启动后后台),失败回退内嵌 baseline-web;
  3. agent 模板:`libra-agent-tpl-*.zip` 种子内置 + Check Update 同 tag 刷新到 `templates/`,Builder(template 模式)直接读缓存,免 GitHub 依赖(离线桌面场景可用;模板平台键注意 **win 桌面是 `x64`**);
  4. 壳自身不自更新(与现状一致,版本迭代靠换装)。

## 8. Release 资产矩阵与 CI(替换 WPF 时代)

| 资产 | 消费方 | 更新方式 |
|---|---|---|
| `libra-desktop-{win-x64\|win-arm64\|linux-x64\|linux-arm64}-{tag}.zip` | Electron Check Update(service+web+version.json,同现有 bundle 契约) | 手动确认 |
| `libra-webapp-{tag}.zip` | Electron 静默更新 | 静默 + 回退 |
| `libra-agent-tpl-{x64\|win-arm64\|linux-x64\|linux-arm64}.zip` | 桌面 Builder 种子内置 + 刷新 | 随 Check Update |
| Electron 安装包(win nsis / linux AppImage,× x64/arm64) | 用户 | 换装 |
| `libra-service-{rid}.zip` | 纯云部署/裸机(保留) | — |
| ~~`libra-shell-win-x64`~~ | 删除(WPF) | — |

- 所有 zip 均伴 `.sha256`,壳强制校验;
- CI:`release-assets.yml` 扩 service 发布到 4 RID(linux-arm64 需注意 runner/交叉),新增 electron-builder job;`templates.yml` 不动;
- 已知风险:win-arm64 实测需自托管 runner → 默认策略 = 构建产出 + x64 全测 + arm64 冒烟降级;win-arm64 agent 模板缺 script 模块(既有限制)。

## 9. 遗留清理清单(WPF)

- 删 `desktop/LibraDesktop/`(壳工程 + `Core/*` + WebView2 依赖)、`desktop/scripts/publish.ps1`;
- `release-assets.yml`:删 shell job 与 `libra-shell-win-x64` 资产;
- CLAUDE.md 第 1 节桌面壳描述、`desktop/README.md` 重写为 Electron 版;发布规范/资产矩阵同步。

## 10. 实施阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | `IStore<T>` + Mongo 适配(`Repository<T>` 实现)+ UserConfig 骨架(读取/暴露,不生效) | 纯重构;Server 编译 + 现有测试全绿(无 Mongo 依赖项) |
| P1 | SqliteStore 核心域 + schema(`PRAGMA user_version`)+ TTL 清理 HostedService + 存储选择生效(启动探测/回退)+ `/api/system/storage` | 核心域双存储同一套测试通过 |
| P2 | AI/MCP/IM 域迁 IStore,SQLite 全功能平权 | 全功能双存储矩阵测试 |
| P3 | Electron 壳 + payload/更新/托盘/内嵌基线/静默 web/远程模式/存储设置 UI | 平台手工冒烟 |
| P4 | CI 4 RID + electron-builder + WPF 删除 + CLAUDE.md/README/desktop README 同步 | tag 发布全资产可下载 |
| P5 | arm64 实测回归(linux-arm64 qemu/真机;win-arm64 自托管 runner) | 冒烟报告 |

## 11. 已知边界与默认项

1. SQLite 完全支持以 P2 为界,核心域先行;AI/MCP/IM 平权是最大工作量,别期待"很快";
2. AOT 不进范围(自包含 JIT),单平台 ~100MB+,含 Electron ~200MB,已接受;
3. 存储切换重启生效、数据不自动迁移、回退仅启动时刻(见 §3 边界);
4. mac 平台 v1 不做;mac 全量 tier 需要 Apple 签名/公证,列入 v1.1(壳可用免签 + xattr 指引分发);
5. 密钥/凭据落盘保护(connectString 明文、JWT 密钥非 Windows 裸存)后续随桌面场景评估。
