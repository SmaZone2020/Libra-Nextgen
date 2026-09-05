using System.Net.Http.Headers;
using System.Text.Json;

namespace LibraNextgen.Service.Services.Platform;

/// <summary>
/// Version-check for the notify-first update flow (LIBRA-style, no emoji):
/// the server compares its own version against the latest GitHub release of
/// the project (same source the template manager uses) and reports the result.
/// Applying updates stays a manual/host-side step by design.
///
/// Configuration (all optional):
///   LIBRA_VERSION        pinned current version (default: the constant below)
///   LIBRA_UPDATE_ENABLED false disables checks (air-gapped deployments)
///   LIBRA_UPDATE_REPO    owner/repo (default SmaZone2020/Libra-Nextgen)
///   LIBRA_UPDATE_TOKEN   GitHub PAT for private repos
/// </summary>
public sealed class UpdateService
{
    // Keep in sync with the latest published tag. LIBRA_VERSION overrides.
    private const string DefaultVersion = "1.7.0";

    public static string CurrentVersion =>
        string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("LIBRA_VERSION"))
            ? DefaultVersion
            : Environment.GetEnvironmentVariable("LIBRA_VERSION")!.Trim();

    private static bool Enabled
    {
        get
        {
            var v = Environment.GetEnvironmentVariable("LIBRA_UPDATE_ENABLED");
            return string.IsNullOrWhiteSpace(v) || !bool.TryParse(v, out var b) || b;
        }
    }

    private static string Repo =>
        NullIfEmpty(Environment.GetEnvironmentVariable("LIBRA_UPDATE_REPO")) ?? "SmaZone2020/Libra-Nextgen";

    private static string? Token => NullIfEmpty(Environment.GetEnvironmentVariable("LIBRA_UPDATE_TOKEN"));

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    // ── DTOs ─────────────────────────────────────────────────────────────

    public sealed record UpdateState(
        bool Enabled,
        string Current,
        string? LatestTag,
        string? HtmlUrl,
        string? PublishedAt,
        string? Notes,
        string? CheckedAt,
        bool UpdateAvailable,
        string? Error);

    /// <summary>Minimal projection of the GitHub "latest release" payload.</summary>
    public sealed record ReleaseInfo(string Tag, string? HtmlUrl, string? PublishedAt, string? Notes);

    // ── Version helpers (pure, unit-testable) ────────────────────────────

    /// <summary>Parse "v1.2.3-beta" style tags into a comparable triple.</summary>
    public static bool TryParseVersion(string? tag, out (int Major, int Minor, int Patch) v)
    {
        v = (0, 0, 0);
        if (string.IsNullOrWhiteSpace(tag)) return false;
        var s = tag.Trim();
        if (s.StartsWith('v')) s = s[1..];

        var segs = s.Split('.');
        var parsed = new int[3];
        for (var i = 0; i < parsed.Length; i++)
        {
            if (i >= segs.Length) break;
            var seg = segs[i];
            var digits = 0;
            while (digits < seg.Length && char.IsAsciiDigit(seg[digits])) digits++;
            if (digits == 0) return false;
            if (!int.TryParse(seg[..digits], out parsed[i])) return false;
        }
        v = (parsed[0], parsed[1], parsed[2]);
        return true;
    }

    public static int CompareVersions(string? a, string? b)
    {
        var okA = TryParseVersion(a, out var va);
        var okB = TryParseVersion(b, out var vb);
        if (okA && okB) return va.CompareTo(vb);
        // Fall back to ordinal when either side is not semver-like.
        return string.CompareOrdinal(a ?? "", b ?? "");
    }

    /// <summary>Extract the release fields the update card needs from the API JSON.</summary>
    public static ReleaseInfo? ParseRelease(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var tag = root.TryGetProperty("tag_name", out var t) ? t.GetString() : null;
            if (string.IsNullOrEmpty(tag)) return null;
            var html = root.TryGetProperty("html_url", out var h) ? h.GetString() : null;
            var published = root.TryGetProperty("published_at", out var p) ? p.GetString() : null;
            var body = root.TryGetProperty("body", out var b) ? b.GetString() : null;
            var preview = string.IsNullOrWhiteSpace(body) ? null : body.Length <= 4000 ? body : body[..4000] + "…";
            return new ReleaseInfo(tag, html, published, preview);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // ── Check state (cached) ─────────────────────────────────────────────

    private static readonly object Gate = new();
    private static UpdateState? _cached;
    private static DateTime _cachedAt = DateTime.MinValue;
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Return the update state. Uses a 15-minute cache; <paramref name="force"/>
    /// bypasses it (the console "check now" button calls with force = true).
    /// </summary>
    public async Task<UpdateState> GetStatusAsync(bool force = false, CancellationToken ct = default)
    {
        if (!Enabled)
            return new UpdateState(false, CurrentVersion, null, null, null, null, null, false, null);

        lock (Gate)
        {
            if (!force && _cached != null && DateTime.UtcNow - _cachedAt < Ttl)
                return _cached;
        }

        UpdateState state;
        try
        {
            var info = await FetchLatestReleaseAsync(ct);
            var available = info != null && CompareVersions(info.Tag, CurrentVersion) > 0;
            state = new UpdateState(true, CurrentVersion, info?.Tag, info?.HtmlUrl, info?.PublishedAt,
                info?.Notes, DateTime.UtcNow.ToString("o"), available, null);
        }
        catch (Exception ex)
        {
            state = new UpdateState(true, CurrentVersion, null, null, null, null,
                DateTime.UtcNow.ToString("o"), false, ex.Message);
        }

        lock (Gate)
        {
            _cached = state;
            _cachedAt = DateTime.UtcNow;
        }
        return state;
    }

    private static async Task<ReleaseInfo?> FetchLatestReleaseAsync(CancellationToken ct)
    {
        var api = $"https://api.github.com/repos/{Repo}/releases/latest";
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("libra-server/1.0");
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        if (Token != null)
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);

        using var resp = await http.GetAsync(api, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"update check failed: GitHub API returned {(int)resp.StatusCode} — check LIBRA_UPDATE_REPO / LIBRA_UPDATE_TOKEN");
        return ParseRelease(await resp.Content.ReadAsStringAsync(ct));
    }
}

