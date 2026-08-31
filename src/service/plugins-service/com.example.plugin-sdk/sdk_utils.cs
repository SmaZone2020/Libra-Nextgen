// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════

using System;
using System.Net.Http;
using System.Collections.Generic;

static class DemoState
{
    public static int Calls;
    public static DateTimeOffset LastCallUtc;
}


static HttpClient MakeClient(string ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
{
    var c = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true })
    {
        Timeout = TimeSpan.FromSeconds(15),
    };
    c.DefaultRequestHeaders.UserAgent.ParseAdd(ua);
    return c;
}

static string Str(object? v, string def = "") => v?.ToString() ?? def;

static int Int(object? v, int def = 0)
{
    try { return Convert.ToInt32(v); } catch { return def; }
}

/// <summary>
/// </summary>
static object? SafeGet(object? p, string name)
{
    if (p is null) return null;
    if (p is IDictionary<string, object> d && d.TryGetValue(name, out var v)) return v;
    if (p is IDictionary<string, object?> dn && dn.TryGetValue(name, out var vn)) return vn;
    return null;
}

static List<string> PluginRootCandidates() => new()
{
    System.IO.Path.GetFullPath(System.IO.Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "plugins", "com.example.plugin-sdk")),
    System.IO.Path.Combine(AppContext.BaseDirectory, "com.example.plugin-sdk"),
    System.IO.Path.GetFullPath(System.IO.Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "plugins-service", "com.example.plugin-sdk")),
};
