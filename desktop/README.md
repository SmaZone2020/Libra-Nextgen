# Libra Desktop(WPF 壳,位于 main)

桌面壳/启动器(WPF),把 Libra-Nextgen 的 Server + Console 以"单个 Windows 桌面 App"
形态分发。代码与 Server / Console / Agent 同在 `main`(单分支工作流);
所有发布产物由 tag 触发的 CI 统一发布到 GitHub Releases。

## Release 资产矩阵(tag 触发;见 .github/workflows/release-assets.yml 与 templates.yml)

| 资产 | 内容 | 消费方 |
|---|---|---|
| libra-agent-tpl-{platform}.zip | Agent 载荷模板(loader/core/模块) | Server Builder(template 模式) |
| libra-shell-win-x64-{tag}.zip | 桌面壳(WPF,自包含单 exe) | 用户直接下载 |
| libra-desktop-win-x64-{tag}.zip | 桌面 bundle:自包含后端 + console(含 version.json) | 壳内 Check Update |
| libra-webapp-{tag}.zip | Console 静态产物(纯前端) | 手工/裸机部署 |
| libra-service-win-x64-{tag}.zip | 自包含单文件后端(win-x64,不含前端) | 裸机部署 |
| libra-service-linux-x64-{tag}.zip | 自包含单文件后端(linux-x64,不含前端) | 裸机部署 |

所有 zip 均有同名 .sha256 伴生资产;壳对 bundle 强制校验 SHA-256,缺失即拒绝。

## 设计(决策摘要)

- **Windows Only**:壳是 WPF + WebView2(WebView2 Runtime:Win11 自带,Win10 目标机
  需 Evergreen Bootstrapper 或预装 Edge)。
- **界面即网页**:窗口为全铺满 WebView2,无工具栏/日志面板;壳操作(检查更新、
  打开远程入口、打开数据目录、退出)全部在系统托盘菜单;关闭窗口即最小化到托盘
  (本地后端继续运行,退出时才回收)。
- **壳只做四件事**:下载/校验 bundle → 解压到本地 → 拉起后端进程 → WebView2 打开入口。
  Console 页面本身仍是网页,壳不重写任何前端 UI。
- **后端不装 Runtime、不装数据库**:后端以自包含单文件 exe 随 bundle 分发(SQLite 单机
  存储是后续工作;完成前可先连接远程/本机已部署的 Server)。
- **两个使用模式**:
  1. 本地模式:安装 bundle 后壳自动拉起后端(127.0.0.1)并导航。
  2. 远程模式:托盘"Open Remote Entry"输入已部署 Server/Console 地址直接连接
     (Console 本身支持运行时切换后端 origin,见 src/console/src/api/client.ts)。

## 目录结构

desktop/
  LibraDesktop/          WPF 壳工程(自包含单文件发布)
    Core/                与 UI 无关的逻辑:路径、设置、payload、进程、GitHub 更新
  scripts/publish.ps1    发布脚本 → dist/shell-win-x64/LibraDesktop.exe
  README.md              本文档

## 运行时文件布局(%LOCALAPPDATA%\LibraDesktop)

settings.json        用户设置(上次入口 URL、GitHub 源)
payload/latest/      当前 bundle(version.json + 后端 exe + web/)
payload/latest.prev/ 上一版(更新回滚槽,下次更新时被覆盖)
downloads/           下载缓存(同名 zip 哈希一致则复用,不重复下载)
logs/                崩溃日志

## 桌面包(libra-desktop-win-x64)内部契约

zip 内部(根目录或至多一层嵌套均可):

version.json         {"tag":"1.7.0","backend":"LibraNextgen.Server.exe","port":5270,"webRoot":"web"}
LibraNextgen.Server.exe   自包含单文件后端(整目录发布:含 appsettings.json/Configuration/Profiles)
web/                console 构建产物(dist),由后端进程内静态托管(见 Program.cs)

壳端安全底线:下载 → SHA-256 校验 → 才解压/执行;校验失败一律拒绝并保留旧版。

## 构建与发布

# 开发构建(需本机 .NET 10 Desktop Runtime)
dotnet build desktop/LibraDesktop/LibraDesktop.csproj

# 生产单文件自包含 exe(目标机零 .NET 依赖)
pwsh desktop/scripts/publish.ps1
# → desktop/dist/shell-win-x64/LibraDesktop.exe

# 发布走 CI:tag(*.*.*)触发 release-assets.yml + templates.yml,资产矩阵见上表。
# 更新源默认指向 SmaZone2020/Libra-Nextgen;可改 settings.json 的 github 段指向 fork;
# 私有/限流场景设环境变量 GITHUB_TOKEN 提高 GitHub API 配额。

## 已知边界(v0.1)

- 壳自更新未做:壳版本迭代靠替换 exe;后端 bundle 更新内置(托盘 Check Update)。
- WebView2 Runtime 缺失时窗口内给出安装指引,不做静默安装。
- 安装器尚未做 MSI/签名:先以绿色单 exe 分发;签名应在正式分发前补(自解压单文件 +
  网络下载执行是 AV 高敏特征)。
- 若壳被强杀,其拉起的后端可能残留;下次启动探测到端口已活会直接接管(External),不重复拉起。