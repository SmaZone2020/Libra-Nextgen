# Platform Support Matrix (Verified Records)

> **Correspondence**: English version of [`../platform-support.md`](../platform-support.md) (Chinese platform support matrix). Content follows the real production implementation.

Verified: 2026-08-26, Windows 11 host (x86_64-pc-windows-msvc), zig 0.x + cargo-zigbuild.

| Platform | Build command | Result | Notes |
|---|---|---|---|
| Windows x64 | `cargo build -p agent` (MSVC) | ✅ Pass | primary platform, all features verified |
| Linux x64 | `cargo zigbuild --target x86_64-unknown-linux-gnu -p agent` | ✅ Pass | cross-compilation passes; runtime behavior not verified on real Linux hardware (no environment) |
| Windows x86 (i686) | `cargo zigbuild --target i686-pc-windows-gnu -p agent` | ❌ Fail | `libra-syscalls` indirect-syscall inline assembly is x64-only (`r10/rcx/rip/r11`); **no 32-bit syscall implementation**. The Builder page's x86 option is disabled |

## Conclusions & Impact

1. **x86 is "unimplemented", not "unverified"**: indirect syscalls (SSN trampoline) only have x64 assembly. Supporting x86 would require 32-bit inline assembly (`sysenter`/`int 0x2e` + `Nt*` SSN table), and there is no 32-bit real-hardware test environment — low priority.
2. **Linux compiles**: the Linux cfg branches of `libra-platform`/`libra-modules` (ip command, exec probing, etc.) compile cleanly; `camera`/`screen` were removed with the zero-WS architecture, and no Windows-only code remains on the Linux side.
3. **Cross-compilation gap**: `cargo-zigbuild` doesn't cover cross-building cdylibs like `libra-psinline` (depends on the MSVC linker) — the Builder's full linux-x64 loader/core build chain still needs further verification on a Linux host or in CI.

## Recommendations

- x86: remove from the Builder platform list or keep disabled (currently disabled)
- Linux: run a real agent registration/heartbeat regression on a Linux CI runner or in WSL later
