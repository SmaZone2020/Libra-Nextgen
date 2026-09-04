using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LibraDesktop.Core;

public enum UpdateOutcome
{
    UpToDate,
    Installed,
}

/// <summary>
/// Pulls the latest backend bundle from a GitHub release. Release contract:
/// one asset per RID named {prefix}{tag}.zip plus a sibling {prefix}{tag}.zip.sha256
/// with the hex digest of the zip. Both are required; the hash is verified before
/// anything is unpacked or executed.
/// </summary>
public sealed class GitHubUpdater
{
    private static readonly HttpClient Http = CreateHttpClient();

    private readonly AppSettings.GitHubSource _source;
    private readonly IProgress<string> _log;

    public GitHubUpdater(AppSettings.GitHubSource source, IProgress<string> log)
    {
        _source = source;
        _log = log;
    }

    /// <summary>
    /// Compare the latest release with the installed payload tag, download when
    /// newer, verify the SHA-256, then install into the active slot.
    /// </summary>
    public async Task<UpdateOutcome> CheckAndInstallAsync()
    {
        var release = await FetchLatestReleaseAsync();
        var zipAsset = release.Assets.FirstOrDefault(a =>
            a.Name.StartsWith(_source.AssetPrefix, StringComparison.OrdinalIgnoreCase)
            && a.Name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidDataException(
                $"release {release.TagName} has no asset matching '{_source.AssetPrefix}*.zip'");

        var installed = PayloadManager.ScanActive();
        if (installed is not null &&
            string.Equals(installed.Manifest.Tag, release.TagName, StringComparison.Ordinal))
        {
            _log.Report($"Already on backend tag {release.TagName}.");
            return UpdateOutcome.UpToDate;
        }

        var hashName = zipAsset.Name + ".sha256";
        var hashAsset = release.Assets.FirstOrDefault(a =>
            string.Equals(a.Name, hashName, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidDataException($"release {release.TagName} is missing '{hashName}'");

        var zipPath = Path.Combine(AppPaths.DownloadsDir, zipAsset.Name);
        var expectedHash = await DownloadHashAsync(hashAsset.BrowserDownloadUrl);
        if (!await DownloadMatchesAsync(zipPath, expectedHash))
        {
            _log.Report($"Downloading {zipAsset.Name} ({FormatMb(zipAsset.Size)}) ...");
            await DownloadZipAsync(zipAsset.BrowserDownloadUrl, zipPath);
        }
        VerifyHash(zipPath, expectedHash);

        await PayloadManager.InstallAsync(zipPath, _log);
        return UpdateOutcome.Installed;
    }

    private async Task<ReleaseInfo> FetchLatestReleaseAsync()
    {
        var url = $"https://api.github.com/repos/{_source.Owner}/{_source.Repo}/releases/latest";
        _log.Report($"Checking {url} ...");
        using var resp = await Http.GetAsync(url);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException(
                $"GitHub API returned {(int)resp.StatusCode} (rate limit? check GITHUB_TOKEN)");
        var json = await resp.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<ReleaseInfo>(json, JsonOpts)
            ?? throw new InvalidDataException("unexpected release payload");
    }

    private async Task<string> DownloadHashAsync(string url)
    {
        using var resp = await Http.GetAsync(url);
        resp.EnsureSuccessStatusCode();
        var text = await resp.Content.ReadAsStringAsync();
        return text.Split([' ', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault()?.Trim()
            ?? throw new InvalidDataException("empty sha256 asset");
    }

    private static async Task<bool> DownloadMatchesAsync(string zipPath, string expectedHash)
    {
        if (!File.Exists(zipPath))
            return false;
        try
        {
            VerifyHash(zipPath, expectedHash);
            return true;
        }
        catch
        {
            File.Delete(zipPath);
            return false;
        }
    }

    private static async Task DownloadZipAsync(string url, string zipPath)
    {
        AppPaths.EnsureDirectories();
        using var resp = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        resp.EnsureSuccessStatusCode();
        await using var src = await resp.Content.ReadAsStreamAsync();
        await using var dst = File.Create(zipPath);
        await src.CopyToAsync(dst);
    }

    private static void VerifyHash(string file, string expectedHex)
    {
        using var sha = SHA256.Create();
        using var stream = File.OpenRead(file);
        var actualHex = Convert.ToHexString(sha.ComputeHash(stream));
        if (!string.Equals(actualHex, expectedHex, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"SHA-256 mismatch for {Path.GetFileName(file)}");
    }

    private static string FormatMb(long bytes) => $"{bytes / 1024.0 / 1024.0:F1} MB";

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromMinutes(20) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("LibraDesktop", "0.1"));
        var token = Environment.GetEnvironmentVariable("GITHUB_TOKEN");
        if (!string.IsNullOrWhiteSpace(token))
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private sealed class ReleaseInfo
    {
        [JsonPropertyName("tag_name")]
        public string TagName { get; set; } = "";

        [JsonPropertyName("assets")]
        public List<ReleaseAsset> Assets { get; set; } = [];
    }

    private sealed class ReleaseAsset
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = "";

        [JsonPropertyName("browser_download_url")]
        public string BrowserDownloadUrl { get; set; } = "";

        [JsonPropertyName("size")]
        public long Size { get; set; }
    }

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };
}
