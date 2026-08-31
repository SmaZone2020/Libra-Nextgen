# Platform Support Matrix (Verified Records)

> **Correspondence**: English version of [`../platform-support.md`](../platform-support.md) (Chinese platform support matrix). Content follows the real production implementation.

Verified: 2026-08-26, Windows 11 host (x86_64-pc-windows-msvc), zig 0.x + cargo-zigbuild.

| Platform | Build command | Result | Notes |
|---|---|---|---|
| Windows x64 | `cargo build -p agent` (MSVC) | ✅ Pass | primary platform, all features verified |
| Linux x64 | `cargo zigbuild --target x86_64-unknown-linux-gnu -p agent` | ✅ Pass | cross-compilation passes; runtime not yet exercised on a real Linux box |

## Findings

1. **Linux compiles**: the Linux cfg branches of `libra-platform`/`libra-modules` (ip command, exec probing, etc.) compile cleanly; `camera`/`screen` were removed with the zero-WS architecture, and no Windows-only code remains on the Linux side.
2. **Cross-compilation gap**: `cargo-zigbuild` doesn't cover cross-building cdylibs like `libra-psinline` (depends on the MSVC linker) — the Builder's full linux-x64 loader/core build chain still needs further verification on a Linux host or in CI.

## Next Steps

- Linux: run a real agent registration/heartbeat regression on a Linux CI runner or in WSL.
