# 更新日志

## [Unreleased]

### 新增
- **跨平台构建**：Builder 新增 `Linux x64` 平台，服务端无论在 Windows 还是 Linux 上运行，均可构建 Windows（x64/x86）与 Linux 载荷
  - 目标 triple 按服务端主机自动解析：Windows 主机 → MSVC 原生 / musl 交叉；Linux 主机 → GNU 原生 / mingw 交叉
  - 交叉构建经 cargo-zigbuild + zig 工具链驱动（自动探测，缺失时给出安装提示），`rustup target add` 自动执行
  - goldberg 混淆仅 Windows 目标执行；模板上传支持 Linux 平台

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
