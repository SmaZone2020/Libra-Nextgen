# 平台支持矩阵(实测记录)

验证时间:2026-09,Windows 11 x64 开发机(rustc stable + zig 交叉 + clang-cl ARM64 交叉)。

状态定义:

- **L1 编译**:目标可稳定编译/链接出包(本机或 CI 验证)。
- **L2 链路实测**:在真实目标环境跑通 注册 → 心跳 → SSE → 模块下发 → 核心模块执行。
- **L3 全功能**:与主力平台同等的全模块实测。

| 平台 | 平台键 | Rust target | 出包方式 | 状态 |
|---|---|---|---|---|
| Windows x64 | `x64` | `x86_64-pc-windows-msvc`(Win 主机)/ `-gnu`(zig) | 源码 / 模板 | ✅ L3 主力平台 |
| Windows x86(顺带) | `x86` | `i686-pc-windows-msvc` / `-gnu` | 源码(source 模式) | ⚠️ L1 编译通过,不做运行时承诺 |
| Windows ARM64 | `win-arm64` | `aarch64-pc-windows-msvc` | 模板(CI)或源码(需 ARM64 MSVC + clang) | ⚠️ L1:core/loader + 6 模块交叉编译/链接验证;运行时需 ARM64 Windows 真机(未测) |
| Linux x64 | `linux-x64` | `x86_64-unknown-linux-gnu` | 源码 / 模板 | ⚠️ 交叉编译 ✅;L2 实测进行中(WSL/CI) |
| Linux ARM64 | `linux-arm64` | `aarch64-unknown-linux-gnu` | 源码 / 模板 | ⚠️ L1 交叉编译 ✅(core/loader/agent + 7 模块);L2 待 ubuntu-arm runner |
| macOS ARM64(M 芯片) | `mac-arm64` | `aarch64-apple-darwin` | 模板(macOS runner 原生)或 macOS 主机源码 | 🔶 CI 编译验证待跑;Linux/Windows 主机无法产 darwin 产物 |

## 平台能力约定

1. **构建方式**:
   - `LIBRA_BUILDER_MODE=template`(默认):Server 无任何 Rust 工具链。打 tag 触发
     `.github/workflows/templates.yml`,在对应 runner 构建 loader(+Windows desktop 变体)、core 与云模块,
     打包 `libra-agent-tpl-{platform}.zip` 发布到 GitHub Releases;Server 按需下载/校验/缓存于
     `build-output/templates/{platform}`,每单构建 = 纯 .NET 加密/注入/打包。Console Builder 页可查看模板状态并刷新。
   - `LIBRA_BUILDER_MODE=source`(开发者):保留本机/镜像内 cargo+zig 编译链路(`deploy/Dockerfile.source`)。
   - macOS 载荷:任何主机都建议走 template 模式;source 模式仅在 macOS 主机上可用。
2. **ABI 约定**:win x64/win x86 模板为 **GNU ABI**(zig,与源码模式容器产物一致);win-arm64 无 rustup GNU std,固定 **MSVC**;
   linux 目标为 glibc GNU;mac 为默认 Mach-O。
3. **模块降级**:非 Windows 平台构建照常产出全部模块,但 Windows 专属语义(token 令牌操作、powershell 宿主、
   creds 的 LSASS/SAM、注册表/计划任务持久化等)在运行时返回明确 "not supported" 错误,不影响其余模块。
   win-arm64 模板暂不含 `script` 模块(rquickjs-sys 0.8 无 aarch64-pc-windows-msvc 预生成 bindings)。
4. **x86(32 位)**:非目标,仅保现有 i686 源码路径不回归,不发布模板、不做运行时承诺。

## 备注

- 各平台模块产物文件名:{module}.{dll|so|dylib},core 为 {core.dll|libcore.so|libcore.dylib},与 Builder 与 Agent 端约定一致。
- Linux/macOS 运行时矩阵仍在补充中(CI 冒烟 + 实机),见部署文档。
