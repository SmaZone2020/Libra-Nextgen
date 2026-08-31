# 操作手册

## 首次登录

1. 启动 Server 与 Console（见 [README 快速开始](../../README.md) 或 [部署手册](../../deployment.md)）：
   - Server：`cd src/service && dotnet run`（端口 5270，需先启动 MongoDB）
   - Console：`cd src/webapp && npm install && npm run dev`（端口 5173）
2. 浏览器访问 <http://localhost:5173> → `/setup` 创建管理员账户
3. 登录后进入主界面

## Agent 上线

1. Console → **Builder** 页在线构建目标平台载荷（Win/Linux）
2. 在目标机器运行产物（exe / 二进制），Agent 自动注册并建立加密会话
3. 顶部设备选择器出现该 Agent（仅显示在线设备）

注意：Agent 端模块按需从 Server 下载，首次执行某类任务（Shell/文件/侦察）时稍慢属正常。

## 交互式 Shell

1. 顶部选中在线 Agent → **终端** 页面
2. 输入命令回车；支持 Tab 补全、方向键、历史（xterm.js + PTY）
3. 切换 Agent 会重新绑定新会话

> 已知限制：中英文混排时终端字符对齐可能轻微错位（CJK 双宽渲染受字体影响）。

## 文件管理

- 分页浏览、上传/下载（流式，实时进度与速度）、压缩包在线浏览、时间戳伪造
- 大文件下载走 2MB 分块 relay + 服务端边收边写，可取消

## 软件数据

「软件数据」页按 Agent 平台显示可用 tab（SSH 跨平台,RDP/Token 仅 Windows）：

| Tab | 说明 | 平台 |
| --- | --- | --- |
| SSH | ~/.ssh 密钥扫描 | 跨平台 |
| RDP | 凭据管理器 + .rdp 文件 | Windows |
| Token | 本机 Token 采集 | Windows |

> 微信 / QQ 数据已迁入插件：`com.libra.wechat-file`(微信账号目录与文件月目录)、
> `com.libra.qqkey`(QQ ClientKey + QQ 空间跳转)。安装对应插件后从「插件管理」进入。

## 插件安装

三种方式（插件管理页）：

1. **上传插件**：选择 zip 包 → 导入并启用
2. **从 Git 导入**：粘贴 Git 链接 → 服务端 clone（仓库名为 pluginId，根目录需 meta.json）
3. **插件市场**：Libra-Plugins 索引一键安装（浏览器缓存 1 小时）

启用后：Agent 端模块首次触发时下载；**插件页面无需重建前端**——页面由服务器在
运行时提供（HTML+JS+CSS,经注入式 `window.Libra` SDK 与宿主交互）,导入后
**刷新控制台页面**即出现在侧边栏「插件管理」分组下。

## MCP 接入

- 端点：`http://localhost:5270/mcp`（Streamable HTTP）
- 鉴权：AccessKey（`Authorization: Bearer lnk_xxx`），在 Console 设置页或 API 创建
- 工具清单：`GET /api/mcp/info`
- AI 客户端可直接调用：任务执行、文件、凭据、插件动作等
- 安全边界：
  - 所有 MCP 工具调用写入 `AuditLogs`（与 REST 相同的风险分级，身份为 access-key 所有者）
  - 破坏性/凭据类工具（`delete_agent`、`delete_file`、`get_rdp_credentials`、`get_ssh_keys`、`kill_process`、`spawn_process`）要求 **Admin** 角色 key
  - `/mcp` 按 key 限流（默认 120 次/分钟），可在 `Program.cs` 的 `mcp` 策略调整
- fork-and-run（`forkexec` 云模块）：`execute_process` 在独立子进程中执行程序并等待结果（支持 args/env/cwd/超时，子进程崩溃不影响 agent）；`spawn_process` 脱胎启动后台进程返回 PID（需 Admin）
- 敏感模块隔离执行：`creds`（RDP/SSH 凭据）在 agent 子进程中执行（Linux fork 隔离，崩溃只损失子进程；Windows 降级进程内执行）
- 插件脚本可直接调用 `exec.run(program, args, {env, cwd, timeoutSeconds})` / `exec.spawn(program, args, {env, cwd})` 在子进程中执行程序

## 审计与风险策略

- 所有指令写入 `AuditLogs`（只增不删），界面不提供删除日志入口
- 设置 → 风险策略：按动作类别（system/file/screen/credentials…）配置默认风险级别并覆盖
- 账户管理：RBAC 角色（Operator/Admin），按权限 key 控制功能

## 一键清理

Server 提供「赛事结束/清理」能力：向所有在线 Agent 下发 `kill_and_clean`，Agent 撤销自建持久化（注册表/Cron/systemd）并退出。