# 平台支持矩阵（实测记录）

验证时间：2026-08-26，Windows 11 主机（x86_64-pc-windows-msvc），zig 0.x + cargo-zigbuild。

| 平台 | 构建命令 | 结果 | 说明 |
|---|---|---|---|
| Windows x64 | `cargo build -p agent`（MSVC） | ✅ 通过 | 主力平台，全部功能验证 |
| Linux x64 | `cargo zigbuild --target x86_64-unknown-linux-gnu -p agent` | ✅ 通过 | 交叉编译通过；运行时行为未在 Linux 实机验证（无环境） |
| Windows x86 (i686) | `cargo zigbuild --target i686-pc-windows-gnu -p agent` | ❌ 失败 | `libra-syscalls` 间接 syscall 内联汇编为 x64 专属（`r10/rcx/rip/r11`）；**无 32 位 syscall 实现**。Builder 页面 x86 选项已禁用 |

## 结论与影响

1. **x86 平台为"未实现"而非"未验证"**：间接 syscall（SSN 跳板）只有 x64 汇编。若要支持 x86，需补 32 位内联汇编（`sysenter`/`int 0x2e` + `Nt*` SSN 表），且无 32 位实机测试环境，优先级低。
2. **Linux 编译通过**：`libra-platform`/`libra-modules` 的 Linux cfg 分支（ip 命令、exec 探测等）编译正常；`camera/screen` 相关已随零 WS 架构删除，Linux 面无遗留 Windows 专属代码。
3. **交叉编译缺口**：`cargo-zigbuild` 对 `libra-psinline`（MSVC 链接器依赖）等 cdylib 的交叉构建未覆盖——Builder 的 linux-x64 目标构建 loader/core 的完整链路需在 Linux 主机或 CI 上进一步验证。

## 建议

- x86：从 Builder 平台列表移除或保持禁用（已禁用）
- Linux：后续在 Linux CI runner 或 WSL 中跑一次真实 agent 注册/心跳回归
