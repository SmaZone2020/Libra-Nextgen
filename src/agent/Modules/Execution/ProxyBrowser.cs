using System.Net;
using System.Text;
using System.Text.Json;

namespace LibraNextgen.Agent.Modules.Execution;

public static class ProxyBrowser
{
    private static readonly HttpClient _http = new(new HttpClientHandler
    {
        AllowAutoRedirect = true,
        UseProxy = false,
        AutomaticDecompression = DecompressionMethods.All,
        ServerCertificateCustomValidationCallback = (_, _, _, _) => true
    })
    {
        Timeout = TimeSpan.FromSeconds(30)
    };

    static ProxyBrowser()
    {
        _http.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
    }

    public static async Task<string> FetchAsync(string url, string method, string? headersJson, string? bodyBase64)
    {
        try
        {
            var req = new HttpRequestMessage(new HttpMethod(method), url);

            if (headersJson != null)
            {
                try
                {
                    using var doc = JsonDocument.Parse(headersJson);
                    foreach (var prop in doc.RootElement.EnumerateObject())
                    {
                        var val = prop.Value.GetString();
                        if (val != null && !string.Equals(prop.Name, "Host", StringComparison.OrdinalIgnoreCase))
                            req.Headers.TryAddWithoutValidation(prop.Name, val);
                    }
                }
                catch { /* ignore bad headers */ }
            }

            if (bodyBase64 != null)
            {
                try
                {
                    req.Content = new ByteArrayContent(Convert.FromBase64String(bodyBase64));
                    if (req.Content.Headers != null && req.Headers.Contains("Content-Type"))
                    {
                        // let TryAddWithoutValidation handle it
                    }
                }
                catch { /* ignore bad body */ }
            }

            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseContentRead);
            var bodyBytes = await resp.Content.ReadAsByteArrayAsync();
            var body = Convert.ToBase64String(bodyBytes);
            var contentType = resp.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
            var finalUrl = resp.RequestMessage?.RequestUri?.ToString() ?? url;

            // Build headers dict manually (AOT-safe), skip Content-Encoding (already decompressed)
            var headerParts = new List<string>();
            foreach (var h in resp.Headers.Concat(resp.Content.Headers))
            {
                if (string.Equals(h.Key, "Content-Encoding", StringComparison.OrdinalIgnoreCase)) continue;
                var vals = string.Join(",", h.Value.Select(v => v.Replace("\\", "\\\\").Replace("\"", "\\\"")));
                headerParts.Add($"\"{Esc(h.Key)}\":[\"{vals}\"]");
            }
            var headers = "{" + string.Join(",", headerParts) + "}";

            return $$"""
            {"status":{{(int)resp.StatusCode}},"statusText":"{{Esc(resp.ReasonPhrase ?? "")}}","headers":{{headers}},"body":"{{Esc(body)}}","contentType":"{{Esc(contentType)}}","url":"{{Esc(finalUrl)}}"}
            """.Replace("\r", "").Replace("\n", "");
        }
        catch (TaskCanceledException)
        {
            return """{"error":"Request timed out"}""";
        }
        catch (HttpRequestException ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
