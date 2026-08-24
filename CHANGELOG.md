# 更新日志

## [Unreleased]

## [1.3.0] - 2026-08-24

### 新增
- **插件体系（三层贯通）**：用户可通过一个 zip 包交付完整插件，贯穿 Agent / 服务端 / 前端三层
  - **Agent 端双通道**：Rhai 脚本（免编译环境）+ native `cdylib`（Rust/C/C++，性能/深度系统调用）
  - **Rhai 脚本引擎**：`#if(WINDOWS)/#elif(LINUX)/#else/#endif` 条件编译（解析前文本裁剪）；平台 API 门控（Windows `cmd/powershell/reg_*`、Linux `shell/bash/uname/ip_route` 等）；沙箱执行（`new_raw` + 白名单函数，排除 print/eval/IO）
  - **服务端**：插件管理（导入/新建/编辑/删除/启用/禁用）、动作网关（`/api/plugins/{pluginId}/{action}` → Agent 任务）、脚本内存缓存（启动预加载）
  - **前端**：插件管理页（HeroUI）、运行时页面注册（`import.meta.glob` 懒加载 + 动态路由）、`usePluginHost` 共享状态（复用 AgentContext + consoleWs）
- **侧边栏树状子母导航**：「功能」与「插件管理」两个折叠母项，子项缩进 + 竖向引导线，展开/收起动画，母项可导航 + 箭头内嵌
- **标准示例插件**：`plugin-sdk`（前端活文档页 + 全功能多平台 Agent 模块）+ `soft-recon` 端到端示例
- **跨平台构建**：Builder 新增 `Linux x64` 平台，服务端在 Windows/Linux 上均可构建 Windows（x64/x86）与 Linux 载荷

### 改进
- **插件脚本内存缓存**：启动时预加载 enabled 插件的 `.rhai`，导入/启停/删除时失效，避免每次执行读磁盘
- **HeroUI 规范**：Input/TextField/NumberField 统一 `variant="secondary"`，文件选择改用 HeroUI Input
- **终端/路径栏/Shell 页面** UI 细节调整

### 修复
- 插件导入 meta.json 反序列化大小写不敏感（camelCase → PascalCase）
- 插件动作网关路由 `{action}` 保留字冲突导致 404（改为 `{actionName}`）
- 插件页面不显示（`import.meta.glob` key 路径未对齐，改用后缀匹配）
- `Engine::new_raw` 缺 Map/Array/String 基础方法导致脚本返回 null（注册 BasicMap/Array/StringPackage）
- rhai 脚本用 `op` 字段分发，否则 shell action 走不到 shell 分支
- 选中插件管理页时母项按钮不激活（`collectRoutes` 纳入母项自身 `to`）

### 安全
- **去除 WebSocket 明文 fallback**：Agent 与服务端在无 session key 时拒绝发送消息（不再明文降级），与 native 模块通道一致

### 其他
- gitignore 屏蔽 `src/plugins/`（服务端插件运行时解压目录）
- QQ clientkey/cookie 提取对齐 `qq_ck_test.py` 流程

## [1.2.2] - 2026-08-18

### 修复
- Shell 页面首次连接重连、移除字体切换器
- 终端字体强制等宽、JetBrains Mono 打包加载、CJK 对齐、字符错位

### 新增
- 平台感知 UI：按选中 Agent 平台显示相关页面/标签页
- Linux 侦察：包管理器清单 + Docker/容器检测
- 可编辑路径栏 + 真实 xterm.js 终端（Agent PTY）

### 改进
- Agent 选择器仅显示在线设备；Linux 构建隐藏 Windows-only 选项
- 平台感知文件路径（Windows 反斜杠 vs Linux 斜杠）
- 模块身份自检 + 构建产物缓存条件
- Builder 预构建产物缓存 + 共享增量 target 目录

## [1.2.1] - 2026-08-17

### 新增
- **RDP 凭证采集**：凭据管理器（TERMSRV）凭证 + 已保存的 .rdp 文件，DPAPI 解密；Console 新增 RDP 标签页
- **QQ clientkey 兑换**：clientkey 经 ptlogin2 jump 接口兑换 skey/p_skey 并计算 bkn，可直接用于 qzone/qun 操作
- **MCP 凭据工具**：RDP 凭证、SSH 密钥、微信/QQ 数据、QQ clientkey
- **MCP Builder 工具**：list_builds / get_build_info 接入真实构建服务（含实时日志）

### 改进
- **云载模块架构**：功能按功能域拆分为 6 个按需下载模块（shell/recon/creds/files/powershell/proxy），内核仅保留通信/加密/调度与流式功能；懒加载 + 会话密钥加密 + 内存加载零落盘
- **流式文件下载**：2MB 分块 relay + 服务端边收边写，大文件不再整读内存
- **下载进度弹窗**：实时进度条、传输速度、已下载/总大小、可取消
- **MCP 任务同步返回**：Shell/截图/Kill 等一次调用直接返回执行结果，无需客户端轮询
- **MCP 可靠性**：Agent 在线校验、输出 1MB 截断、结构化错误、统一超时

### 修复
- MCP 浏览器密码/历史/AI 密钥工具消息类型过时导致必超时
- `scan_wifi` 引用不存在的 `WifiScan` 任务类型
- WebSocket 关闭握手异常（agent 优雅关闭 + 服务端容错）

### 其他
- README 精简
