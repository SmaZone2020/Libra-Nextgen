# 更新日志

## [1.4.0] - 2026-08-25

### 新增
- **插件市场**：独立 Libra-Plugins 仓库（zip + `index.json` 索引，CI 自动重建），控制台一键安装；索引与包走 GitHub raw 前端直连，索引本地缓存 1 小时
- **Git 导入插件**：粘贴 Git 链接即可 clone 到插件目录（仓库名为 pluginId）；「导入插件」改「上传插件」，移除「新建插件」
- **QQ 插件**：对齐 `qq_ck_test.py`（端口取 clientkey → jump 兑换 QQ 空间链接，无内存扫描/skey/bkn）；自动加载列表+头像，ClientKey 明文，可跳转 QQ 空间
- **QQ 功能并入插件**：「软件数据」里的 QQ（tab/接口/MCP/Agent 模块）移除，统一由 `com.libra.qqkey` 提供
- **AI API Key 插件**：进页自动扫描、明文展示、按厂商分组

### 改进
- **Agent 并发处理**：WS 消息逐条并发执行，模块在锁外运行，长任务不再阻塞接收/心跳
- **Webapp 构建修复**：`react-aria-components ^1.20.0` 对齐 HeroUI 3.2.4，修复 CI 与类型错误

## [1.3.0] - 2026-08-24

### 新增
- **插件体系（三层贯通）**：zip 包交付 Agent（Rhai/native 双通道）+ 服务端（管理/动作网关/脚本缓存）+ 前端（页面注册/usePluginHost）
- **Rhai 脚本引擎**：`#if(WINDOWS)/#elif(LINUX)` 条件编译、平台 API 门控、沙箱执行
- **侧边栏树状导航**、标准示例插件（plugin-sdk）、Linux x64 跨平台构建

### 修复
- 插件导入/动作网关/页面显示/脚本空值等一系列插件链路问题
- 去除 WebSocket 明文 fallback（无会话密钥即拒绝发送）

## [1.2.2] - 2026-08-18

- Shell 终端修复（重连/等宽字体/CJK 对齐）、平台感知 UI、Linux 侦察（包/Docker）、可编辑路径栏 + 真实 xterm

## [1.2.1] - 2026-08-17

- RDP 凭证采集（凭据管理器 + .rdp）、QQ clientkey 兑换、MCP 凭据/Builder 工具、云载模块架构（6 个按需下载模块）、流式文件下载