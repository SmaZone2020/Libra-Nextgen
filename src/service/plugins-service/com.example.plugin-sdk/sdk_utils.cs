// ═══════════════════════════════════════════════════════════════════════
//  com.example.plugin-sdk — 服务端工具/状态（service/sdk_utils.cs）
// ═══════════════════════════════════════════════════════════════════════
//  【多文件组织演示】
//  宿主按文件名排序把 service/ 下所有 .cs 拼接为单个 C# Script 编译，
//  因此本文件的 using / 静态类 / 工具函数在 main.cs 中可直接使用。
//  约定：
//    - 各 .cs 文件都写自己的 using（拼接后重复 using 是合法的）。
//    - 函数级声明（static string Str(...) 等）以「后出现的文件」为准，
//      所以工具类放这里、导出函数放 main.cs（main.cs 最后拼接）。
//    - 跨调用状态用静态字段（脚本程序集只编译一次，多次调用间保留）。
// ═══════════════════════════════════════════════════════════════════════

using System;
using System.Net.Http;
using System.Collections.Generic;

// ── 跨调用状态：脚本程序集只编译一次，静态字段在多次调用间保持 ────────
static class DemoState
{
    public static int Calls;
    public static DateTimeOffset LastCallUtc;
}

// ── 通用工具（供 main.cs 使用）──────────────────────────────────────────

/// <summary>创建带默认 UA 的 HttpClient（超时 15s，随调用方覆盖）。</summary>
static HttpClient MakeClient(string ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
{
    var c = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true })
    {
        Timeout = TimeSpan.FromSeconds(15),
    };
    c.DefaultRequestHeaders.UserAgent.ParseAdd(ua);
    return c;
}

/// <summary>安全取值：object → string（null 时返回默认值）。</summary>
static string Str(object? v, string def = "") => v?.ToString() ?? def;

/// <summary>安全取值：object → int。</summary>
static int Int(object? v, int def = 0)
{
    try { return Convert.ToInt32(v); } catch { return def; }
}

/// <summary>定位插件包根目录（运行时解压目录优先，其次仓库内开发目录）。</summary>
static List<string> PluginRootCandidates() => new()
{
    // 部署形态：PluginsBaseDir = AppContext.BaseDirectory\..\..\..\..\plugins
    System.IO.Path.GetFullPath(System.IO.Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "plugins", "com.example.plugin-sdk")),
    // 直接挂在 bin 旁
    System.IO.Path.Combine(AppContext.BaseDirectory, "com.example.plugin-sdk"),
    // 开发源目录（service/main.cs 的开发副本）
    System.IO.Path.GetFullPath(System.IO.Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "plugins-service", "com.example.plugin-sdk")),
};
