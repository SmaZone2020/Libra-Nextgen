// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
//
//
//
// ═══════════════════════════════════════════════════════════════════════

using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Collections.Generic;
using System.Linq;


string Echo(object? p)
{
    return JsonSerializer.Serialize(new
    {
        received = new
        {
            text = Str(SafeGet(p, "text")),
            count = Int(SafeGet(p, "count"), -1),
            nested = SafeGet(p, "nested"),
            anyExtra = SafeGet(p, "extra"),
        },
        paramTypes = new
        {
            text = (SafeGet(p, "text") ?? "null").GetType().Name,
            count = (SafeGet(p, "count") ?? "null").GetType().Name,
        },
        serverTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
    });
}

string Now(object? p)
{
    var format = Str(SafeGet(p, "format"), "yyyy-MM-dd HH:mm:ss");
    var t = Int(SafeGet(p, "utc"), 0) == 1 ? DateTimeOffset.UtcNow : DateTimeOffset.Now;
    return JsonSerializer.Serialize(new
    {
        format,
        value = t.ToString(format),
        utc = t.Offset == TimeSpan.Zero,
        unix = t.ToUnixTimeSeconds(),
    });
}

long Bkn(object? p)
{
    var skey = Str(SafeGet(p, "skey"));
    long h = 5381;
    foreach (var c in skey) h += (h << 5) + c;
    return h & 0x7fffffff;
}

string State(object? p)
{
    DemoState.Calls++;
    DemoState.LastCallUtc = DateTimeOffset.UtcNow;
    return JsonSerializer.Serialize(new
    {
        calls = DemoState.Calls,
        lastCallUtc = DemoState.LastCallUtc.ToString("yyyy-MM-dd HH:mm:ss"),
        note = "静态字段随脚本编译缓存保留；服务重启后清零",
    });
}

string Ip(object? p)
{
    using var c = MakeClient();
    var resp = c.GetStringAsync("https://api.ipify.org?format=json").GetAwaiter().GetResult();
    using var doc = JsonDocument.Parse(resp);
    return JsonSerializer.Serialize(new
    {
        ip = doc.RootElement.GetProperty("ip").GetString(),
        via = "server-script",
    });
}

string Http(object? p)
{
    var url = Str(SafeGet(p, "url"));
    if (string.IsNullOrWhiteSpace(url))
        throw new ArgumentException("http: url 必填（可选项：method/headers/body/timeoutSec）");

    var method = Str(SafeGet(p, "method"), "GET").ToUpperInvariant();
    var timeoutSec = Math.Clamp(Int(SafeGet(p, "timeoutSec"), 15), 1, 120);

    using var c = MakeClient();
    c.Timeout = TimeSpan.FromSeconds(timeoutSec);
    using var req = new HttpRequestMessage(new HttpMethod(method), url);

    if (SafeGet(p, "headers") is IDictionary<string, object> hdrs)
    {
        foreach (var kv in hdrs)
        {
            var sv = kv.Value?.ToString();
            if (string.IsNullOrEmpty(sv)) continue;
            if (string.Equals(kv.Key, "User-Agent", StringComparison.OrdinalIgnoreCase))
                c.DefaultRequestHeaders.UserAgent.ParseAdd(sv);
            else if (!string.Equals(kv.Key, "Content-Type", StringComparison.OrdinalIgnoreCase))
                req.Headers.TryAddWithoutValidation(kv.Key, sv);
        }
    }

    var body = SafeGet(p, "body");
    if (body is not null && method is "POST" or "PUT" or "PATCH")
    {
        var text = body switch
        {
            string s => s,
            _ => JsonSerializer.Serialize(body),
        };
        req.Content = new StringContent(text, Encoding.UTF8, "application/json");
    }

    var sw = System.Diagnostics.Stopwatch.StartNew();
    try
    {
        using var resp = c.Send(req);
        var respText = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        sw.Stop();
        return JsonSerializer.Serialize(new
        {
            ok = true,
            status = (int)resp.StatusCode,
            reason = resp.ReasonPhrase,
            elapsedMs = sw.ElapsedMilliseconds,
            headers = new
            {
                contentType = resp.Content.Headers.ContentType?.ToString(),
                server = resp.Headers.Server?.ToString(),
                date = resp.Headers.Date?.ToString("o"),
            },
            bodyLength = respText.Length,
            truncated = respText.Length > 2048,
            body = respText.Length > 2048 ? respText[..2048] : respText,
        });
    }
    catch (Exception ex)
    {
        sw.Stop();
        return JsonSerializer.Serialize(new
        {
            ok = false,
            error = ex.Message,
            elapsedMs = sw.ElapsedMilliseconds,
        });
    }
}

string ReadFile(object? p)
{
    var name = Str(SafeGet(p, "name"), "meta.json");
    foreach (var root in PluginRootCandidates())
    {
        var path = System.IO.Path.Combine(root, name);
        if (!System.IO.File.Exists(path)) continue;
        var bytes = System.IO.File.ReadAllBytes(path);
        var preview = System.Text.Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 500));
        return JsonSerializer.Serialize(new
        {
            found = true,
            name,
            path,
            size = bytes.Length,
            preview,
        });
    }
    return JsonSerializer.Serialize(new
    {
        found = false,
        name,
        tried = PluginRootCandidates(),
        hint = "把数据文件放进插件包根目录（如 data/xxx.json），随 zip 一起分发",
    });
}

string List(object? p)
{
    var count = Math.Clamp(Int(SafeGet(p, "count"), 5), 1, 100);
    var prefix = Str(SafeGet(p, "prefix"), "item");
    var items = Enumerable.Range(1, count)
        .Select(i => (object)new { index = i, label = $"{prefix}-{i}", enabled = i % 2 == 0 })
        .ToList();
    return JsonSerializer.Serialize(items);
}

string Table(object? p)
{
    var rows = Math.Clamp(Int(SafeGet(p, "rows"), 3), 1, 20);
    var prefix = Str(SafeGet(p, "prefix"), "sdk");
    var statuses = new[] { "online", "offline", "error", "idle" };
    var items = Enumerable.Range(1, rows)
        .Select(i => (object)new
        {
            id = $"{prefix}-{i:000}",
            name = $"能力 {prefix} #{i}",
            status = statuses[i % statuses.Length],
            score = (i * 13) % 100,
            note = i % 3 == 0 ? "需要设备在线" : "就绪",
        })
        .ToList();
    return JsonSerializer.Serialize(items);
}

string Fail(object? p)
{
    throw new InvalidOperationException(Str(SafeGet(p, "message"), "demo failure"));
}

string Manifest(object? p)
{
    var funcs = new object[]
    {
        new { name = "echo",     desc = "动态参数访问：原样回显 body（支持任意嵌套）", options = new object[] {
            new { name = "text",  type = "string", optional = true, desc = "任意文本" },
            new { name = "count", type = "number", optional = true, desc = "任意数字" },
            new { name = "nested", type = "object", optional = true, desc = "任意嵌套对象" } } },
        new { name = "now",      desc = "DateTime 格式化（服务端当前时间）", options = new object[] {
            new { name = "format", type = "string", optional = true, @default = "yyyy-MM-dd HH:mm:ss", desc = ".NET 日期格式" },
            new { name = "utc",    type = "number", optional = true, @default = "0", desc = "1=UTC，0/缺省=本地时区" } } },
        new { name = "bkn",      desc = "签名计算（bkn/g_tk 算法，纯数学不依赖网络）", options = new object[] {
            new { name = "skey", type = "string", optional = false, desc = "skey 输入" } } },
        new { name = "state",    desc = "跨调用内存状态（静态字段，脚本编译缓存保留）", options = Array.Empty<object>() },
        new { name = "ip",       desc = "服务端 GET 外网 IP（演示无 CORS 网络请求）", options = Array.Empty<object>() },
        new { name = "http",     desc = "通用 HTTP 请求（服务端发起，可带任意请求头）", options = new object[] {
            new { name = "url",        type = "string", optional = false, desc = "目标地址" },
            new { name = "method",     type = "string", optional = true, @default = "GET", desc = "GET/POST/PUT/DELETE…" },
            new { name = "headers",    type = "object", optional = true, desc = "请求头，如 { \"X-Token\": \"abc\" }" },
            new { name = "body",       type = "any",    optional = true, desc = "POST/PUT/PATCH 请求体（对象自动 JSON）" },
            new { name = "timeoutSec", type = "number", optional = true, @default = "15", desc = "超时秒数（1-120）" } } },
        new { name = "file",     desc = "读取插件包内随包分发的文件", options = new object[] {
            new { name = "name", type = "string", optional = true, @default = "meta.json", desc = "包内相对路径" } } },
        new { name = "list",     desc = "返回数组（演示结构化数组返回）", options = new object[] {
            new { name = "count",  type = "number", optional = true, @default = "5", desc = "条目数（1-100）" },
            new { name = "prefix", type = "string", optional = true, @default = "item", desc = "条目前缀" } } },
        new { name = "table",    desc = "返回对象数组（前端 Table 直接渲染）", options = new object[] {
            new { name = "rows",   type = "number", optional = true, @default = "3", desc = "行数（1-20）" },
            new { name = "prefix", type = "string", optional = true, @default = "sdk", desc = "id 前缀" } } },
        new { name = "fail",     desc = "抛异常 → 宿主返回 { ok:false, error }（错误契约）", options = new object[] {
            new { name = "message", type = "string", optional = true, @default = "demo failure", desc = "错误消息" } } },
    };
    return JsonSerializer.Serialize(new
    {
        pluginId = "com.example.plugin-sdk",
        host = "ServerScriptService (Roslyn C# Scripting)",
        endpoint = "POST /api/plugin/com.example.plugin-sdk/<函数名>",
        contract = new { ok = true, data = "函数返回值", error = "抛异常时的错误消息" },
        callCount = DemoState.Calls,
        funcs,
    });
}


return new Dictionary<string, Func<object, object>>
{
    ["echo"]     = p => Echo(p),
    ["now"]      = p => Now(p),
    ["bkn"]      = p => Bkn(p),
    ["state"]    = p => State(p),
    ["ip"]       = p => Ip(p),
    ["http"]     = p => Http(p),
    ["file"]     = p => ReadFile(p),
    ["list"]     = p => List(p),
    ["table"]    = p => Table(p),
    ["fail"]     = p => Fail(p),
    ["manifest"] = p => Manifest(p),
};
