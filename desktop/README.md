# Libra Desktop(desktop 分支)

本分支**只承载桌面壳/启动器(WPF)**,用于把 Libra-Nextgen 的 Server + Console 以
"单个 Windows 桌面 App"形态分发。本分支**不含** Server / Console / Agent 源码,
它们继续在 `main` 上开发并发布;两者之间通过 GitHub Releases 资产衔接,因此本分支
**永不合并回 main**,也不需要从 main 同步(壳不引用 Server/Console 源码)。

## 设计(决策摘要)

- **Windows Only**:壳是 WPF + WebView2(WebView2 Runtime:Win11 自带,Win10 目标机
  需 Evergreen Bootstrapper 或预装 Edge)。
- **壳只做四件事**:下载/校验 bundle → 解压到本地 → 拉起后端进程 → WebView2 打开入口。
  Console 页面本身仍是网页,壳不重写任何前端 UI。
- **后端不装 Runtime、不装数据库**:后端以自包含单文件 exe 随 bundle 分发(SQLite 单机
  存储是 main 分支的后续工作;在它完成前,桌面壳可先连接远程/本机已部署的 Server)。
- **两个使用模式**:
  1. 本地模式:安装 bundle 后壳自动拉起后端(127.0.0.1)并导航。
  2. 远程模式:在 Entry URL 输入已部署 Server/Console 地址直接连接(Console 本身支持
     运行时切换后端 origin,见 `main` 上 `src/console/src/api/client.ts`)。

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

## Bundle 发布契约(给 main 分支 CI 的约定)

每个 release 需要两个成对资产(desktop 壳 Check Update 只认这个约定):

libra-desktop-win-x64-{tag}.zip          自包含后端 + console 静态文件
libra-desktop-win-x64-{tag}.zip.sha256   zip 的 SHA-256 十六进制摘要(壳端校验,缺失即拒绝)

zip 内部(根目录或至多一层嵌套均可):

version.json         {"tag":"1.7.0","backend":"LibraNextgen.Server.exe","port":5270,"webRoot":"web"}
LibraNextgen.Server.exe   自包含单文件后端(dotnet publish -r win-x64 --self-contained -p:PublishSingleFile=true)
web/                console 构建产物(dist)—— 后端需能托管它(静态文件托管是 main 分支工作)

壳端安全底线:下载 → SHA-256 校验 → 才解压/执行;校验失败一律拒绝并保留旧版。

## 构建与发布

# 开发构建(需本机 .NET 10 Desktop Runtime)
dotnet build desktop/LibraDesktop/LibraDesktop.csproj

# 生产单文件自包含 exe(目标机零 .NET 依赖)
pwsh desktop/scripts/publish.ps1
# → desktop/dist/shell-win-x64/LibraDesktop.exe

# 更新源默认指向 SmaZone2020/Libra-Nextgen;可改 settings.json 的 github 段指向 fork;
# 私有/限流场景设环境变量 GITHUB_TOKEN 提高 GitHub API 配额。

## 已知边界(v0.1)

- 不做托盘常驻与壳自更新(后端 bundle 更新已有);壳版本迭代靠替换 exe。
- WebView2 Runtime 缺失时给出安装指引,不做静默安装。
- 安装器尚未做 MSI/签名:先以绿色单 exe 分发;签名应在正式分发前补(自解压单文件 +
  网络下载执行是 AV 高敏特征)。
- 若壳被强杀,其拉起的后端可能残留;下次启动探测到端口已活会直接接管(External),不重复拉起。
