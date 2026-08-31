// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════

using System;
using System.Text.Json;
using System.Collections.Generic;

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


return new Dictionary<string, Func<object, object>>
{
    ["manifest"] = p => Manifest((dynamic)p),
};
