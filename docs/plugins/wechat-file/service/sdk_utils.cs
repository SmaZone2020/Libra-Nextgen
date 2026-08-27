// ═══════════════════════════════════════════════════════════════════════
//  服务端脚本（service/sdk_utils.cs）— 工具类/静态状态
// ═══════════════════════════════════════════════════════════════════════
//  com.libra.wechat-file —— 微信文件插件。
//  本插件主要能力在 Agent 端（native wechat_file 模块），服务端脚本仅
//  提供自描述 manifest 与少量辅助函数（随包分发）。
// ═══════════════════════════════════════════════════════════════════════

using System;
using System.Text.Json;
using System.Collections.Generic;

/// <summary>跨调用状态示例（服务重启清零）。</summary>
static class WechatFileState
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
