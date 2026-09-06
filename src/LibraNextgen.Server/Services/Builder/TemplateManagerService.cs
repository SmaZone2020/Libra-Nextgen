using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text.Json;
using LibraNextgen.Service.Models;

namespace LibraNextgen.Service.Services.Builder;

/// <summary>
/// Prebuilt platform-template distribution (LIBRA_BUILDER_MODE=template, the
/// default). Per-platform zips published by GitHub Actions (workflow
/// .github/workflows/templates.yml on a version tag) are downloaded, verified
/// and cached under build-output/templates/{platform}. The builder then only
/// performs pure-.NET packaging — no Rust toolchain is required on the server.
///
/// Configuration (all optional):
///   LIBRA_BUILDER_MODE          template (default) | source
///   LIBRA_TEMPLATE_REPO         owner/repo (default SmaZone2020/Libra-Nextgen)
///   LIBRA_TEMPLATE_TAG          release tag or "latest" (default latest)
///   LIBRA_TEMPLATE_TOKEN        GitHub PAT for private repos (default none)
///   LIBRA_TEMPLATE_BASE_URL     self-hosted mirror base (asset URL = base/asset)
///   LIBRA_TEMPLATE_ASSET_PREFIX asset prefix (default libra-agent-tpl)
///   LIBRA_TEMPLATE_TIMEOUT_SECONDS  download timeout (default 600)
/// </summary>
public sealed class TemplateManagerService
{
    // ── Config ───────────────────────────────────────────────────────────

    public sealed record TemplateConfig(
        bool TemplateMode,
        string Repo,
        string Tag,
        string? Token,
        string? BaseUrl,
        string AssetPrefix,
        int TimeoutSeconds);

    /// <summary>Read the template configuration from the environment.</summary>
    public static TemplateConfig LoadConfig()
    {
        var mode = Env("LIBRA_BUILDER_MODE").Trim().ToLowerInvariant();
        return new TemplateConfig(
            TemplateMode: mode is "" or "template",
            Repo: EnvOr("LIBRA_TEMPLATE_REPO", "SmaZone2020/Libra-Nextgen"),
            Tag: EnvOr("LIBRA_TEMPLATE_TAG", "latest").Trim(),
            Token: NullIfEmpty(Env("LIBRA_TEMPLATE_TOKEN").Trim()),
            BaseUrl: NullIfEmpty(Env("LIBRA_TEMPLATE_BASE_URL").Trim().TrimEnd('/')),
            AssetPrefix: EnvOr("LIBRA_TEMPLATE_ASSET_PREFIX", "libra-agent-tpl").Trim(),
            TimeoutSeconds: int.TryParse(Env("LIBRA_TEMPLATE_TIMEOUT_SECONDS"), out var t) ? Math.Clamp(t, 10, 3600) : 600);
    }

    public static string AssetName(string platform) => $"{LoadConfig().AssetPrefix}-{platform}.zip";

    public static string CacheDir(string platform) => Path.Combine(OutputBase, "templates", platform);

    /// <summary>Resolve the templates root; honors LIBRA_BUILDS_DIR.</summary>
    private static string OutputBase
    {
        get
        {
            var env = Environment.GetEnvironmentVariable("LIBRA_BUILDS_DIR");
            return string.IsNullOrWhiteSpace(env)
                ? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "build-output"))
                : Path.GetFullPath(env);
        }
    }

    // ── Cached template record ───────────────────────────────────────────

    public sealed record CachedTemplate(string Platform, string Asset, string Tag, string Commit, string BuiltAt, long ZipBytes);

    private const string CacheFileName = "cache.json";

    public CachedTemplate? Info(string platform) =>
        BuildPlatforms.Specs.ContainsKey(platform) ? ReadCache(CacheDir(platform)) : null;

    private static CachedTemplate? ReadCache(string cacheDir)
    {
        var path = Path.Combine(cacheDir, CacheFileName);
        if (!File.Exists(path)) return null;
        try
        {
            return JsonSerializer.Deserialize<CachedTemplate>(File.ReadAllText(path));
        }
        catch
        {
            return null;
        }
    }

    // ── Ensure / refresh ─────────────────────────────────────────────────

    private static readonly SemaphoreSlim Gate = new(1, 1);

    /// <summary>
    /// Ensure a verified template for <paramref name="platform"/> is cached.
    /// The cache is reused while (asset, tag) match the current configuration;
    /// a moved "latest" tag requires an explicit refresh.
    /// </summary>
    public async Task<CachedTemplate> EnsureAsync(string platform, Action<string>? log = null, CancellationToken ct = default)
    {
        var cfg = LoadConfig();
        if (!BuildPlatforms.Specs.ContainsKey(platform))
            throw new InvalidOperationException($"Unsupported platform: {platform}");

        var asset = AssetName(platform);
        var cacheDir = CacheDir(platform);
        if (IsCurrent(cacheDir, asset, cfg.Tag))
        {
            log?.Invoke($"Template cache hit for {platform} ({asset}, tag {cfg.Tag})");
            return ReadCache(cacheDir)!;
        }

        await Gate.WaitAsync(ct);
        try
        {
            if (IsCurrent(cacheDir, asset, cfg.Tag))
                return ReadCache(cacheDir)!;

            var zipPath = Path.Combine(Path.GetTempPath(), $"{asset}.{Guid.NewGuid():N}.zip");
            try
            {
                var url = await ResolveAssetUrlAsync(cfg, asset);
                log?.Invoke($"Downloading {asset} (tag {cfg.Tag})…");
                await DownloadAsync(cfg, url, zipPath, ct);
                var size = new FileInfo(zipPath).Length;
                log?.Invoke($"Downloaded {asset}: {size / 1024} KB");

                var install = InstallZip(zipPath, platform, cacheDir, asset, size, cfg.Tag);
                log?.Invoke(
                    $"Template {platform} ready — tag {install.Tag}, commit {install.Commit}, {install.FileCount} files" +
                    (install.MissingModules.Length > 0
                        ? $", modules absent from template: {string.Join(", ", install.MissingModules)}"
                        : ""));
                return ReadCache(cacheDir)!;
            }
            finally
            {
                try { if (File.Exists(zipPath)) File.Delete(zipPath); } catch { /* best effort */ }
            }
        }
        finally
        {
            Gate.Release();
        }
    }

    /// <summary>Drop the cached template for a platform and fetch it again.</summary>
    public async Task<CachedTemplate> RefreshAsync(string platform, Action<string>? log = null, CancellationToken ct = default)
    {
        if (!BuildPlatforms.Specs.ContainsKey(platform))
            throw new InvalidOperationException($"Unsupported platform: {platform}");
        var cacheDir = CacheDir(platform);
        if (Directory.Exists(cacheDir))
        {
            try { Directory.Delete(cacheDir, true); }
            catch (Exception ex) { throw new InvalidOperationException($"failed to clear template cache {cacheDir}: {ex.Message}", ex); }
        }
        return await EnsureAsync(platform, log, ct);
    }

    private static bool IsCurrent(string cacheDir, string asset, string tag)
    {
        var cached = ReadCache(cacheDir);
        if (cached == null || cached.Asset != asset) return false;
        // cache.json records the real release tag from the zip manifest, which
        // never equals the literal "latest". "latest" is a moving pointer, so a
        // verified cached template satisfies it until an explicit refresh
        // (RefreshAsync / POST templates/refresh) pulls a newer release.
        if (tag.Equals("latest", StringComparison.OrdinalIgnoreCase)) return true;
        return cached.Tag == tag;
    }

    // ── URL resolution & download ────────────────────────────────────────

    private static async Task<string> ResolveAssetUrlAsync(TemplateConfig cfg, string asset)
    {
        if (cfg.BaseUrl != null)
            return $"{cfg.BaseUrl}/{asset}";

        if (cfg.Token == null)
        {
            // Public repo: github.com serves /releases/latest/download and
            // /releases/download/{tag} with a redirect to the asset.
            var release = cfg.Tag.Equals("latest", StringComparison.OrdinalIgnoreCase)
                ? "latest/download"
                : $"download/{cfg.Tag}";
            return $"https://github.com/{cfg.Repo}/releases/{release}/{asset}";
        }

        // Private repo: resolve the asset through the API to get a signed URL.
        var api = cfg.Tag.Equals("latest", StringComparison.OrdinalIgnoreCase)
            ? $"https://api.github.com/repos/{cfg.Repo}/releases/latest"
            : $"https://api.github.com/repos/{cfg.Repo}/releases/tags/{Uri.EscapeDataString(cfg.Tag)}";
        using var http = NewHttp(cfg);
        using var resp = await http.GetAsync(api, HttpCompletionOption.ResponseHeadersRead);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"template lookup failed: {api} returned {(int)resp.StatusCode} — check LIBRA_TEMPLATE_REPO / LIBRA_TEMPLATE_TAG / LIBRA_TEMPLATE_TOKEN");
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        if (doc.RootElement.TryGetProperty("assets", out var assets))
        {
            foreach (var a in assets.EnumerateArray())
            {
                var name = a.GetProperty("name").GetString();
                if (string.Equals(name, asset, StringComparison.OrdinalIgnoreCase))
                {
                    var url = a.GetProperty("browser_download_url").GetString();
                    if (!string.IsNullOrEmpty(url)) return url;
                }
            }
        }
        var tagName = doc.RootElement.TryGetProperty("tag_name", out var t) ? t.GetString() : cfg.Tag;
        throw AssetNotFound(cfg, asset, tagName);
    }

    private static HttpClient NewHttp(TemplateConfig cfg)
    {
        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(cfg.TimeoutSeconds) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("libra-server/1.0");
        return http;
    }

    private static InvalidOperationException AssetNotFound(TemplateConfig cfg, string asset, string? tag)
    {
        var where = cfg.BaseUrl != null
            ? $"mirror {cfg.BaseUrl}"
            : $"release '{tag ?? cfg.Tag}' of {cfg.Repo}";
        return new InvalidOperationException(
            $"template asset '{asset}' not found in {where}. " +
            "Publish templates by tagging the repo (runs .github/workflows/templates.yml), or point " +
            "LIBRA_TEMPLATE_REPO / LIBRA_TEMPLATE_TAG / LIBRA_TEMPLATE_BASE_URL / LIBRA_TEMPLATE_TOKEN at the right source; " +
            "to build from source instead set LIBRA_BUILDER_MODE=source.");
    }

    private static async Task DownloadAsync(TemplateConfig cfg, string url, string destPath, CancellationToken ct)
    {
        using var http = NewHttp(cfg);
        if (cfg.Token != null && url.StartsWith("https://api.github.com/", StringComparison.OrdinalIgnoreCase))
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", cfg.Token);
        using var resp = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"template download failed: HTTP {(int)resp.StatusCode} for {url}");
        await using var src = await resp.Content.ReadAsStreamAsync(ct);
        await using var dst = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None, 128 * 1024, useAsync: true);
        await src.CopyToAsync(dst, ct);
    }

    // ── Install / validation ─────────────────────────────────────────────

    public sealed record ZipInstall(string Platform, string Tag, string Commit, string BuiltAt, int FileCount, string[] MissingModules);

    /// <summary>Expected payload entry names per platform: loader, desktop-loader (windows), core.</summary>
    public static (string Loader, string? DesktopLoader, string Core) PayloadNames(string platform) =>
        BuilderBuildService.OsOf(platform) switch
        {
            "windows" => ("loader.exe", "loader_desktop.exe", "core.dll"),
            "macos" => ("loader", null, "libcore.dylib"),
            _ => ("loader", null, "libcore.so"),
        };

    /// <summary>
    /// Validate a downloaded template zip and install it into the platform
    /// cache directory. Throws <see cref="InvalidDataException"/> with an
    /// actionable message when the archive does not match the platform layout.
    /// </summary>
    public static ZipInstall InstallZip(string zipPath, string platform, string cacheDir, string asset, long zipBytes, string expectedTag)
    {
        var (loader, desktopLoader, core) = PayloadNames(platform);
        var ext = BuilderBuildService.ModuleExt(platform);
        var modules = BuilderBuildService.CloudModules.Select(m => $"{m.Module}.{ext}").ToArray();

        CachedTemplate cached;
        int presentCount;
        using (var zip = ZipFile.OpenRead(zipPath))
        {
            var entries = zip.Entries.ToDictionary(e => e.Name, StringComparer.Ordinal);

            // Manifest first: carries provenance (tag/commit) and platform.
            if (!entries.TryGetValue("manifest.json", out var manifestEntry))
                throw new InvalidDataException($"template {Path.GetFileName(zipPath)} is missing manifest.json — not a libra template zip");
            ZipManifest manifest;
            try
            {
                using var sr = new StreamReader(manifestEntry.Open());
                manifest = JsonSerializer.Deserialize<ZipManifest>(sr.ReadToEnd()) ?? new ZipManifest();
            }
            catch (Exception ex)
            {
                throw new InvalidDataException($"template manifest.json is invalid: {ex.Message}", ex);
            }
            if (!string.IsNullOrEmpty(manifest.platform) &&
                !string.Equals(manifest.platform, platform, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"template platform mismatch: zip is for '{manifest.platform}', requested '{platform}'");

            var required = new List<string> { loader, core };
            if (desktopLoader != null) required.Add(desktopLoader);
            var missingRequired = required.Where(name => !entries.ContainsKey(name)).ToList();
            var missingModules = modules.Where(m => !entries.ContainsKey(m)).ToList();
            if (missingRequired.Count > 0)
                throw new InvalidDataException(
                    $"template {Path.GetFileName(zipPath)} is incomplete for {platform}; missing: {string.Join(", ", missingRequired)} — " +
                    "regenerate templates from a newer tag (the publish workflow layout may have changed)");
            if (missingModules.Count > 0)
            {
                // Modules are optional: platforms with third-party binding gaps
                // (e.g. win-arm64 without the QuickJS script module) ship a
                // reduced set; EnsureAsync reports them on the log line.
            }

            // Install into a fresh sibling dir, then swap, so a failed copy
            // never leaves a half-populated cache behind.
            var parent = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(cacheDir))!;
            Directory.CreateDirectory(parent);
            var tmp = cacheDir + ".tmp-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(tmp);
            try
            {
                foreach (var entry in zip.Entries)
                {
                    if (entry.FullName.Contains("..") || entry.FullName.StartsWith('/') || entry.FullName.Contains('\\'))
                        throw new InvalidDataException($"template zip contains an unsafe path: {entry.FullName}");
                    if (entry.FullName.EndsWith('/')) continue;
                    entry.ExtractToFile(Path.Combine(tmp, entry.Name), overwrite: true);
                }
                cached = new CachedTemplate(platform, asset, manifest.tag ?? expectedTag, manifest.commit ?? "unknown", manifest.built_at ?? "", zipBytes);
                File.WriteAllText(Path.Combine(tmp, CacheFileName), JsonSerializer.Serialize(cached));
                if (Directory.Exists(cacheDir)) Directory.Delete(cacheDir, true);
                Directory.Move(tmp, cacheDir);
            }
            catch
            {
                try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { /* best effort */ }
                throw;
            }
            presentCount = zip.Entries.Count(e => !e.FullName.EndsWith('/') && e.Length > 0);
        }

        return new ZipInstall(platform, cached.Tag, cached.Commit, cached.BuiltAt, presentCount,
            modules.Where(m => !File.Exists(Path.Combine(cacheDir, m))).ToArray());
    }

    private sealed class ZipManifest
    {
        public string? platform { get; set; }
        public string? tag { get; set; }
        public string? commit { get; set; }
        public string? built_at { get; set; }
    }

    private static string Env(string name) => Environment.GetEnvironmentVariable(name) ?? string.Empty;

    private static string EnvOr(string name, string fallback) => NullIfEmpty(Env(name).Trim()) ?? fallback;

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
