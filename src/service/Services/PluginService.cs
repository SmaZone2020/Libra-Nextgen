using System.IO.Compression;
using System.Text.Json;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Models;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Lifecycle manager for plugins: validates + extracts archives, persists
/// records, and stages Agent-side modules into the platform module directories
/// that <c>AgentCommsController.DownloadModule</c> serves.
///
/// Server-side plugin code is NOT loaded into this process. Only the meta.json
/// contract and the declared module artifacts are ever staged; a plugin's
/// <c>service/</c> logic, if present, is intentionally not executed here — it is
/// handled by a separate sandboxed host (out of scope for this skeleton).
/// </summary>
public class PluginService
{
    private readonly Repository<PluginRecord> _plugins;
    private readonly ILogger<PluginService> _logger;

    /// <summary>Root directory where plugin packages are extracted.</summary>
    public static readonly string PluginsBaseDir = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "plugins"));

    /// <summary>Platform keys understood by the module staging logic.</summary>
    private static readonly string[] Platforms = ["x64", "x86", "linux-x64"];

    public PluginService(Repository<PluginRecord> plugins, ILogger<PluginService> logger)
    {
        _plugins = plugins;
        _logger = logger;
    }

    // ── Queries ────────────────────────────────────────────────────────

    public Task<List<PluginRecord>> GetAllAsync(CancellationToken ct = default) => _plugins.GetAllAsync(ct);

    public Task<PluginRecord?> GetByIdAsync(string id, CancellationToken ct = default) => _plugins.GetByIdAsync(id, ct);

    public Task<PluginRecord?> GetByPluginIdAsync(string pluginId, CancellationToken ct = default) =>
        _plugins.FirstOrDefaultAsync(p => p.PluginId == pluginId, ct);

    public async Task<List<PluginRecord>> GetEnabledAsync(CancellationToken ct = default) =>
        await _plugins.FindAsync(p => p.Enabled, ct);

    // ── Import from archive ────────────────────────────────────────────

    /// <summary>
    /// Extract a zip archive, read + validate meta.json, persist a record, and
    /// stage modules when the plugin is enabled on import.
    /// </summary>
    public async Task<PluginRecord> ImportAsync(
        Stream archiveStream, bool enableOnImport, CancellationToken ct = default)
    {
        var meta = ParseMetaFromZip(archiveStream);
        ValidateMeta(meta);

        var pluginId = meta.PluginId;
        var targetDir = Path.Combine(PluginsBaseDir, pluginId);

        // Re-read the stream for extraction (ParseMetaFromZip consumed position).
        archiveStream.Position = 0;
        ExtractZip(archiveStream, targetDir);

        var existing = await _plugins.FirstOrDefaultAsync(p => p.PluginId == pluginId, ct);
        var now = DateTime.UtcNow.ToString("o");

        if (existing != null)
        {
            existing.Name = meta.Name;
            existing.Version = meta.Version;
            existing.Author = meta.Author;
            existing.Description = meta.Description;
            existing.Entry = meta.Entry;
            existing.I18n = meta.I18n;
            existing.Actions = meta.Actions;
            existing.UpdatedAt = now;
            existing.Enabled = enableOnImport;
            await _plugins.UpdateAsync(existing.Id,
                Builders<PluginRecord>.Update
                    .Set(p => p.Name, meta.Name)
                    .Set(p => p.Version, meta.Version)
                    .Set(p => p.Author, meta.Author)
                    .Set(p => p.Description, meta.Description)
                    .Set(p => p.Entry, meta.Entry)
                    .Set(p => p.I18n, meta.I18n)
                    .Set(p => p.Actions, meta.Actions)
                    .Set(p => p.UpdatedAt, now)
                    .Set(p => p.Enabled, enableOnImport), ct);
        }
        else
        {
            existing = new PluginRecord
            {
                PluginId = pluginId,
                Name = meta.Name,
                Version = meta.Version,
                Author = meta.Author,
                Description = meta.Description,
                Entry = meta.Entry,
                I18n = meta.I18n,
                Actions = meta.Actions,
                Enabled = enableOnImport,
                InstalledAt = now,
            };
            await _plugins.InsertAsync(existing, ct);
        }

        if (enableOnImport)
            StageModules(existing);
        else
            UnstageModules(existing);

        return existing!;
    }

    // ── Create / Edit / Delete / Toggle ────────────────────────────────

    public async Task<PluginRecord> CreateAsync(PluginCreateRequest request, CancellationToken ct = default)
    {
        if (request.Meta == null)
            throw new ArgumentException("meta is required");
        ValidateMeta(request.Meta);

        if (await _plugins.ExistsAsync(p => p.PluginId == request.Meta.PluginId, ct))
            throw new InvalidOperationException($"plugin '{request.Meta.PluginId}' already exists");

        var rec = new PluginRecord
        {
            PluginId = request.Meta.PluginId,
            Name = request.Meta.Name,
            Version = request.Meta.Version,
            Author = request.Meta.Author,
            Description = request.Meta.Description,
            Entry = request.Meta.Entry,
            I18n = request.Meta.I18n,
            Actions = request.Meta.Actions,
            Enabled = false,
            InstalledAt = DateTime.UtcNow.ToString("o"),
        };
        await _plugins.InsertAsync(rec, ct);
        // Ensure extraction directory exists even for hand-authored plugins.
        Directory.CreateDirectory(Path.Combine(PluginsBaseDir, rec.PluginId));
        return rec;
    }

    public async Task<PluginRecord?> UpdateAsync(string id, PluginMeta meta, CancellationToken ct = default)
    {
        ValidateMeta(meta);
        var existing = await _plugins.GetByIdAsync(id, ct);
        if (existing == null) return null;

        var update = Builders<PluginRecord>.Update
            .Set(p => p.Name, meta.Name)
            .Set(p => p.Version, meta.Version)
            .Set(p => p.Author, meta.Author)
            .Set(p => p.Description, meta.Description)
            .Set(p => p.Entry, meta.Entry)
            .Set(p => p.I18n, meta.I18n)
            .Set(p => p.Actions, meta.Actions)
            .Set(p => p.UpdatedAt, DateTime.UtcNow.ToString("o"));
        await _plugins.UpdateAsync(id, update, ct);

        if (existing.Enabled) StageModules(existing);
        return await _plugins.GetByIdAsync(id, ct);
    }

    public async Task<PluginRecord?> DeleteAsync(string id, CancellationToken ct = default)
    {
        var existing = await _plugins.GetByIdAsync(id, ct);
        if (existing == null) return null;

        UnstageModules(existing);
        await _plugins.DeleteAsync(id, ct);

        // Best-effort cleanup of extracted files.
        try
        {
            var dir = Path.Combine(PluginsBaseDir, existing.PluginId);
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to remove extracted files for plugin {PluginId}", existing.PluginId);
        }
        return existing;
    }

    public async Task<PluginRecord?> SetEnabledAsync(string id, bool enabled, CancellationToken ct = default)
    {
        var existing = await _plugins.GetByIdAsync(id, ct);
        if (existing == null) return null;

        await _plugins.UpdateAsync(id,
            Builders<PluginRecord>.Update.Set(p => p.Enabled, enabled), ct);

        if (enabled) StageModules(existing);
        else UnstageModules(existing);

        return await _plugins.GetByIdAsync(id, ct);
    }

    // ── Module staging ─────────────────────────────────────────────────

    /// <summary>Copy the plugin's module/*.dll|so into the served module dirs.</summary>
    private void StageModules(PluginRecord plugin)
    {
        var srcDir = Path.Combine(PluginsBaseDir, plugin.PluginId, "module");
        if (!Directory.Exists(srcDir)) return;

        foreach (var platform in Platforms)
        {
            var srcPlatformDir = Path.Combine(srcDir, platform);
            if (!Directory.Exists(srcPlatformDir)) continue;

            var ext = platform.StartsWith("linux") ? ".so" : ".dll";
            var dstDir = BuilderBuildService.ModulesDirFor(platform);
            Directory.CreateDirectory(dstDir);

            foreach (var file in Directory.EnumerateFiles(srcPlatformDir, "*" + ext))
            {
                try
                {
                    File.Copy(file, Path.Combine(dstDir, Path.GetFileName(file)), overwrite: true);
                    _logger.LogInformation("Staged plugin module {File} for {Platform}", Path.GetFileName(file), platform);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to stage module {File}", file);
                }
            }
        }
    }

    /// <summary>Remove the plugin's staged modules from the served dirs.</summary>
    private void UnstageModules(PluginRecord plugin)
    {
        var srcDir = Path.Combine(PluginsBaseDir, plugin.PluginId, "module");
        var names = new HashSet<string>();

        if (Directory.Exists(srcDir))
        {
            foreach (var platform in Platforms)
            {
                var srcPlatformDir = Path.Combine(srcDir, platform);
                if (!Directory.Exists(srcPlatformDir)) continue;
                foreach (var f in Directory.EnumerateFiles(srcPlatformDir))
                    names.Add(Path.GetFileName(f));
            }
        }

        foreach (var platform in Platforms)
        {
            var dstDir = BuilderBuildService.ModulesDirFor(platform);
            if (!Directory.Exists(dstDir)) continue;
            foreach (var name in names)
            {
                var p = Path.Combine(dstDir, name);
                if (File.Exists(p))
                {
                    try { File.Delete(p); }
                    catch (Exception ex) { _logger.LogWarning(ex, "Failed to unstage module {File}", p); }
                }
            }
        }
    }

    // ── Archive helpers ────────────────────────────────────────────────

    private static PluginMeta ParseMetaFromZip(Stream stream)
    {
        using var zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
        var entry = zip.GetEntry("meta.json")
            ?? throw new InvalidDataException("archive is missing meta.json");

        using var sr = new StreamReader(entry.Open());
        // Case-insensitive + camelCase matching: meta.json uses camelCase keys
        // (e.g. "argsSchema", "pluginId") while the C# model is PascalCase.
        // Without this, nested classes like PluginAction.Action stay "" and
        // fail validation with "each action requires a non-empty 'action'".
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        return JsonSerializer.Deserialize<PluginMeta>(sr.ReadToEnd(), options)
            ?? throw new InvalidDataException("meta.json could not be parsed");
    }

    private static void ExtractZip(Stream stream, string targetDir)
    {
        using var zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);

        foreach (var entry in zip.Entries)
        {
            // Defend against path traversal inside the archive.
            var destPath = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
            var targetDirFull = Path.GetFullPath(targetDir);
            if (!destPath.StartsWith(targetDirFull + Path.DirectorySeparatorChar) && destPath != targetDirFull)
                throw new InvalidDataException($"archive entry escapes target directory: {entry.FullName}");

            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(destPath);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
            entry.ExtractToFile(destPath, overwrite: true);
        }
    }

    private static void ValidateMeta(PluginMeta meta)
    {
        if (string.IsNullOrWhiteSpace(meta.PluginId))
            throw new ArgumentException("pluginId is required");
        if (meta.PluginId.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_')))
            throw new ArgumentException("pluginId may only contain letters, digits, '.', '-', '_'");
        if (string.IsNullOrWhiteSpace(meta.Name))
            throw new ArgumentException("name is required");

        foreach (var action in meta.Actions)
        {
            if (string.IsNullOrWhiteSpace(action.Action))
                throw new ArgumentException("each action requires a non-empty 'action'");
        }
    }
}
