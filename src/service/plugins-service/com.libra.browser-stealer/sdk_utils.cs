// ═══════════════════════════════════════════════════════════════════════
//  服务端脚本（service/sdk_utils.cs）— 工具类/静态状态
// ═══════════════════════════════════════════════════════════════════════
//  com.libra.browser-stealer —— 浏览器数据插件。
//  主要能力在 Agent 端（native browser_stealer 模块），服务端脚本仅提供
//  自描述 manifest 与少量辅助函数（随包分发）。
// ═══════════════════════════════════════════════════════════════════════

using System;
using System.Net.Http;
using System.Text.Json;
using System.Collections.Generic;

/// <summary>跨调用状态示例（服务重启清零）。</summary>
static class BrowserState
{
    public static int Calls;
}

/// <summary>安全取值：object → string。</summary>
static string Str(object? v, string def = "") => v?.ToString() ?? def;

/// <summary>创建带默认 UA 的 HttpClient（服务端发起，无 CORS）。</summary>
static HttpClient MakeClient(string ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
{
    var c = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true })
    {
        Timeout = TimeSpan.FromSeconds(15),
    };
    c.DefaultRequestHeaders.UserAgent.ParseAdd(ua);
    return c;
}
