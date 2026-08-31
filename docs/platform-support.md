# 平台支持矩阵（实测记录）

验证时间：2026-08-26，Windows 11 主机（x86_64-pc-windows-msvc），zig 0.x + cargo-zigbuild。

| 平台 | 构建命令 | 结果 | 说明 |
|---|---|---|---|
| Windows x64 | `cargo build -p agent`（MSVC） | ✅ 通过 | 主力平台，全部功能验证 |
| Linux x64 | `cargo zigbuild --target x86_64-unknown-linux-gnu -p agent` | ✅ 通过 | 交叉编译通过；运行时行为未在 Linux 实机验证（无环境） |

## 结论与影响

1. **Linux 编译通过**：`libra-platform`/`libra-modules` 的 Linux cfg 分支（ip 命令、exec 探测等）编译正常；`camera/screen` 相关已随零 WS 架构删除，Linux 面无遗留 Windows 专属代码。
2. **交叉编译缺口**：`cargo-zigbuild` 对 `libra-psinline`（MSVC 链接器依赖）等 cdylib 的交叉构建未覆盖——Builder 的 linux-x64 目标构建 loader/core 的完整链路需在 Linux 主机或 CI 上进一步验证。

## 建议

- Linux：后续在 Linux CI runner 或 WSL 中跑一次真实 agent 注册/心跳回归
