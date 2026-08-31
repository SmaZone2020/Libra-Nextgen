// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════

using System;
using System.Text.Json;
using System.Collections.Generic;

static class WechatFileState
{
    public static int Calls;
}

static string Str(object? v, string def = "") => v?.ToString() ?? def;

static HttpClient MakeClient(string ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
{
    var c = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true })
    {
        Timeout = TimeSpan.FromSeconds(15),
    };
    c.DefaultRequestHeaders.UserAgent.ParseAdd(ua);
    return c;
}
