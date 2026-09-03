# Platform Support Matrix (Verified Records)

> **Correspondence**: English version of [`../platform-support.md`](../platform-support.md) (Chinese platform support matrix). Content follows the real production implementation.

Verified 2026-09 on a Windows 11 x64 dev box (rustc stable + zig cross + clang-cl ARM64 cross)
plus the GitHub Actions template matrix (tag 1.6.0, all five platforms green).

Status definitions:

- **L1 Compile**: target compiles/links reliably (verified locally or in CI).
- **L2 Chain**: end-to-end exercised on a real target environment — register → heartbeat → SSE → module delivery → core modules.
- **L3 Full**: all-module runtime parity with the primary platform.

| Platform | Key | Rust target | Payload path | Status |
|---|---|---|---|---|
| Windows x64 | `x64` | `x86_64-pc-windows-msvc` (Win host) / `-gnu` (zig) | source / template | ✅ L3 primary platform |
| Windows x86 (best effort) | `x86` | `i686-pc-windows-msvc` / `-gnu` | source mode only | ⚠️ L1 compiles; no runtime commitment |
| Windows ARM64 | `win-arm64` | `aarch64-pc-windows-msvc` | template (CI) or source (needs ARM64 MSVC + clang) | ⚠️ L1: core/loader + 6 modules compile & publish in CI ✅; runtime needs a real ARM64 Windows box (untested) |
| Linux x64 | `linux-x64` | `x86_64-unknown-linux-gnu` | source / template | ✅ L2: WSL Debian exercised register→task→report (3/3); full feature set untested |
| Linux ARM64 | `linux-arm64` | `aarch64-unknown-linux-gnu` | source / template | ⚠️ L1 cross-compile + CI template ✅; L2 pending ubuntu-arm runner / real box |
| macOS ARM64 (M-chip) | `mac-arm64` | `aarch64-apple-darwin` | template (macOS runner native) or source on a macOS host | ⚠️ CI compile + template publish + payload-on-any-host ✅; runtime pending a real Mac |

## Platform capability conventions

1. **Build modes**:
   - `LIBRA_BUILDER_MODE=template` (default): the server carries no Rust toolchain. Pushing a tag triggers
     `.github/workflows/templates.yml`, which builds the loader (+ Windows desktop variant), core and cloud
     modules on the matching runners and publishes `libra-agent-tpl-{platform}.zip` to GitHub Releases. The
     server downloads/verifies/caches them under `build-output/templates/{platform}`; every build is pure-.NET
     packaging. The Console Builder page shows template state and can refresh.
   - `LIBRA_BUILDER_MODE=source` (bare-metal development only): keeps the in-place cargo+zig compile chain;
     Docker images are fixed to template mode and no source-compile image is shipped.
   - macOS payloads: use template mode on any host; source mode works on macOS hosts only.
2. **ABI convention**: the win x64 template is **GNU ABI** (zig);
   win-arm64 has no rustup GNU std and is fixed to **MSVC**; Linux targets are glibc GNU; macOS is native Mach-O.
3. **Module degradation**: non-Windows platforms still build all modules, but Windows-only semantics (token
   manipulation, PowerShell host, LSASS/SAM creds, registry/scheduled-task persistence, …) return a clear
   "not supported" error at runtime and never affect other modules. The win-arm64 template currently omits the
   `script` module (rquickjs-sys 0.8 ships no pregenerated bindings for aarch64-pc-windows-msvc).
4. **x86 (32-bit)**: not a goal — the existing i686 source path is kept non-regressing, no templates, no runtime commitment.

## Notes

- Module artifact names per platform: {module}.{dll|so|dylib}; core is {core.dll|libcore.so|libcore.dylib},
  matching the Builder and Agent conventions.
- The Linux/macOS runtime matrix is still being filled in (CI smoke + real boxes); see the deployment docs.
