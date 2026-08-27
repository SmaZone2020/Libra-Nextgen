// ═══════════════════════════════════════════════════════════════════════
//  服务端脚本（service/main.cs）— 导出函数
// ═══════════════════════════════════════════════════════════════════════
//  com.libra.wechat-file —— 微信文件插件。
//  统一入口：POST /api/plugin/com.libra.wechat-file/<函数名>
//  主要能力在 Agent 端 native 模块（wechat_file），本文件提供辅助函数。
// ═══════════════════════════════════════════════════════════════════════

using System;
using System.Text.Json;
using System.Collections.Generic;

// 1) manifest —— 自描述：返回函数目录（前端可实时渲染）。
string Manifest(dynamic p)
{
    WechatFileState.Calls++;
    return JsonSerializer.Serialize(new
    {
        pluginId = "com.libra.wechat-file",
        host = "ServerScriptService (Roslyn C# Scripting)",
        endpoint = "POST /api/plugin/com.libra.wechat-file/<函数名>",
        callCount = WechatFileState.Calls,
        funcs = new object[]
        {
            new { name = "manifest", desc = "自描述函数目录", options = Array.Empty<object>() },
        },
    });
}

// ═══════════════ 导出（宿主要求的契约：Dictionary<string, Func<object, object>>）═══════════════

return new Dictionary<string, Func<object, object>>
{
    ["manifest"] = p => Manifest((dynamic)p),
};
