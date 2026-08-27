# Libra Plugin: WeChat File (com.libra.wechat-file)

Libra-Nextgen 微信文件插件：扫描本机微信（`xwechat_files`）已登录账号与
消息文件月份目录，前端保持原「软件数据 → 微信」标签页 UI 与操作（浏览/下载）。

## 结构

```
wechat-file/
├── meta.json            # 插件契约（必需，zip 根目录）
├── module/
│   └── wechat_file      # Agent 端 native 模块（Rust cdylib；源码在
│                        #   src/agent-rs/plugins/wechat-file/，编译产物 .dll 放 x64/）
├── service/
│   ├── sdk_utils.cs     # 工具类/静态状态（按文件名排序，先拼接）
│   └── main.cs          # 导出函数（manifest）
├── page/
│   └── index.tsx        # 前端页面源码（分发用；生效位置 src/webapp/src/plugins/<id>/）
├── pack.mjs             # 零依赖打包脚本
└── README.md
```

## 动作（meta.json actions）

| action | module | op | 说明 |
|---|---|---|---|
| `collect` | `wechat_file` (native) | `collect` | 扫描微信账号，返回 `{ accounts: [{wxid, path, fileDirs}] }` |

文件浏览/下载由前端复用宿主 `files` 模块（`listFiles` / `downloadFile`）。

## 构建 native 模块

```bash
cd src/agent-rs
cargo build --release -p wechat-file-plugin
# 产物 src/agent-rs/target/release/wechat_file_plugin.dll
# 拷贝到 src/plugins/com.libra.wechat-file/module/x64/wechat_file.dll
```

## 打包

```bash
npm run pack   # → dist/com.libra.wechat-file-1.0.0.zip
```
