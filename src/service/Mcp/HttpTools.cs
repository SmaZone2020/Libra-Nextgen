using System.ComponentModel;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using ModelContextProtocol.Server;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// Outbound HTTP tool for the AI assistant. Runs on the TeamServer, so it can
/// reach internal networks as well as the public internet — access is gated by
/// Justitia tiers/approvals like every other tool.
/// </summary>
[McpServerToolType]
public static class HttpTools
{
    private static readonly HttpClient Http = new(new HttpClientHandler { AllowAutoRedirect = true });

    private const int MaxBodyBytes = 1024 * 1024; // response body cap (1 MB)

    [McpServerTool]
    [Description("向任意 URL 发起 HTTP 请求（在 TeamServer 上执行，可访问内网与外网）。支持自定义请求方法、请求头、请求体、HTTP/1.1 或 HTTP/2、超时；返回状态码、响应头、响应体与耗时。高危：需人工批准（SSRF 面广）。")]
    public static async Task<string> http_request(
        [Description("完整 URL（必填），如 https://api.example.com/v1/data")] string url,
        [Description("请求方法：GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS（默认 GET）")] string? method,
        [Description("请求头 JSON 对象，如 {\"Content-Type\":\"application/json\",\"Authorization\":\"Bearer xxx\"}")] string? headers,
        [Description("请求体字符串（JSON 或文本）；GET/HEAD 忽略")] string? body,
        [Description("HTTP 版本：1.1 / 2（默认 1.1；2 不可用时自动降级）")] string? httpVersion,
        [Description("超时秒数（默认 15，最大 120）")] int? timeoutSeconds,
        CancellationToken ct = default)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(url)
                || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                return McpUtils.Error("url 必须是 http/https 绝对地址");
            }

            var httpMethod = (method ?? "GET").Trim().ToUpperInvariant();
            if (httpMethod is not ("GET" or "POST" or "PUT" or "PATCH" or "DELETE" or "HEAD" or "OPTIONS"))
                return McpUtils.Error($"不支持的请求方法: {httpMethod}");

            using var req = new HttpRequestMessage(new HttpMethod(httpMethod), uri);
            // "2" requests HTTP/2 but tolerates downgrade when the server lacks h2.
            req.Version = httpVersion == "2" ? HttpVersion.Version20 : HttpVersion.Version11;
            req.VersionPolicy = HttpVersionPolicy.RequestVersionOrLower;

            if (!string.IsNullOrWhiteSpace(headers))
            {
                JsonElement root;
                try
                {
                    using var doc = JsonDocument.Parse(headers!);
                    root = doc.RootElement.Clone();
                }
                catch (JsonException)
                {
                    return McpUtils.Error("headers 必须是 JSON 对象");
                }
                if (root.ValueKind != JsonValueKind.Object)
                    return McpUtils.Error("headers 必须是 JSON 对象");
                foreach (var prop in root.EnumerateObject())
                {
                    var value = prop.Value.ValueKind == JsonValueKind.String
                        ? prop.Value.GetString()
                        : prop.Value.GetRawText();
                    if (string.IsNullOrEmpty(prop.Name) || string.IsNullOrEmpty(value)) continue;
                    if (!req.Headers.TryAddWithoutValidation(prop.Name, value))
                        req.Content?.Headers.TryAddWithoutValidation(prop.Name, value);
                }
            }

            if (httpMethod is not ("GET" or "HEAD") && body != null)
            {
                req.Content = new StringContent(body, Encoding.UTF8);
                // Default to JSON when the body looks like JSON and no Content-Type header was set.
                if (req.Content.Headers.ContentType == null && body.TrimStart().StartsWith('{'))
                {
                    req.Content.Headers.ContentType =
                        new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
                }
            }

            var timeout = TimeSpan.FromSeconds(Math.Clamp(timeoutSeconds ?? 15, 1, 120));
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeout);

            var sw = Stopwatch.StartNew();
            using var resp = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);

            string respBody = "";
            if (httpMethod != "HEAD")
            {
                var raw = await resp.Content.ReadAsStringAsync(cts.Token);
                respBody = raw.Length > MaxBodyBytes
                    ? raw[..MaxBodyBytes] + "\n...(truncated)"
                    : raw;
            }
            sw.Stop();

            var respHeaders = resp.Headers
                .Concat(resp.Content?.Headers ?? Enumerable.Empty<KeyValuePair<string, IEnumerable<string>>>())
                .ToDictionary(h => h.Key, h => string.Join("; ", h.Value));

            return McpUtils.Ok(new
            {
                status = (int)resp.StatusCode,
                reason = resp.ReasonPhrase,
                version = resp.Version.ToString(),
                headers = respHeaders,
                body = respBody,
                elapsedMs = sw.ElapsedMilliseconds,
            });
        }
        catch (OperationCanceledException)
        {
            return McpUtils.Error("request timed out or was cancelled");
        }
        catch (Exception ex)
        {
            return McpUtils.Error(ex.Message);
        }
    }
}