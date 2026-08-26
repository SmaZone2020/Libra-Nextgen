// ═══════════════════════════════════════════════════════════════════════
//  com.example.plugin-sdk — 服务端脚本全能力演示（service/main.cs）
// ═══════════════════════════════════════════════════════════════════════
//  执行宿主：ServerScriptService（Roslyn C# Scripting，编译结果按插件缓存）
//  统一入口：POST /api/plugin/com.example.plugin-sdk/<函数名>
//            body 任意 JSON → 脚本函数参数 p（dynamic，body 为空时为 null）
//
//  【多文件组织】
//  宿主把 service/ 下所有 *.cs 按文件名排序拼接为单个脚本再编译：
//    sdk_utils.cs —— using / DemoState（跨调用状态）/ MakeClient / Str / Int /
//                     PluginRootCandidates（工具类，先拼接）
//    main.cs      —— 本文件（最后拼接），导出函数 + 末尾 return Dictionary
//
//  【脚本约定】
//   1. 文件末尾必须 return new Dictionary<string, Func<object, object>>，
//      键 = 函数名，值 = 处理函数；处理函数返回任意可 JSON 序列化对象。
//   2. 可直接使用引用库：System / System.Net.Http / System.Text.Json /
//      System.Collections.Generic / System.Dynamic / System.Linq 等，
//      可自己 new HttpClient 发网络请求（服务端发起，无 CORS）。
//   3. 函数是同步签名，但内部可用 .GetAwaiter().GetResult() 阻塞等待异步
//      （如 HttpClient），宿主不限制内部耗时（有整体超时保护）。
//   4. 抛异常 → 宿主统一返回 { ok:false, error:<消息> }（错误契约）。
//   5. 可用类型声明（class）保存跨调用状态：脚本程序集只编译一次并被缓存，
//      静态字段在多次调用之间保持不变。
//   6. 可用 AppContext.BaseDirectory 定位插件包目录，读取随包分发的数据文件。
//   7. 注意：把 dynamic 值传给普通方法（如 Str/Int）时，调用会变成动态调度
//      且返回值类型变为 dynamic；请先做静态转换 (object?)p?.字段 再传参。
//
//  【本文件演示的能力矩阵】（前端"服务端脚本"页会调用 manifest 实时拉取）
//   echo    动态参数访问（任意嵌套 JSON）
//   now     DateTime 格式化（format/utc 可选项）
//   bkn     纯计算/签名算法（服务端算 bkn/g_tk）
//   state   跨调用内存状态（静态字段）
//   ip      服务端 GET 网络请求（无 CORS）
//   http    通用 HTTP 请求（method/headers/body/timeoutSec 可选项）
//   file    读取插件包内随包分发的文件
//   list    返回数组（count/prefix 可选项）
//   table   返回对象数组（给前端 Table 用）
//   fail    抛异常 → 演示错误契约 {ok:false,error}
//   manifest 自描述：返回本脚本全部函数目录（名称/说明/可选项/返回）
// ═══════════════════════════════════════════════════════════════════════

using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Collections.Generic;
using System.Linq;

// ── 函数实现（每个函数 = 一个能力点） ───────────────────────────────────

// 1) echo —— 动态参数访问：body 的任意字段都能以 p.字段 直接读（含嵌套对象）。
string Echo(dynamic p)
{
    return JsonSerializer.Serialize(new
    {
        // 原样回显参数（演示任意嵌套结构访问）
        received = new
        {
            text = Str((object?)p?.text),
            count = Int((object?)p?.count, -1),
            nested = p?.nested,   // 嵌套对象直接透传
            anyExtra = p?.extra,  // 未约定字段也能读
        },
        paramTypes = new
        {
            text = (p?.text ?? "null").GetType().Name,
            count = (p?.count ?? "null").GetType().Name,
        },
        serverTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
    });
}

// 2) now —— DateTime 格式化。可选项：format（默认 yyyy-MM-dd HH:mm:ss）、utc（默认 0）。
string Now(dynamic p)
{
    var format = Str((object?)p?.format, "yyyy-MM-dd HH:mm:ss");
    var t = Int((object?)p?.utc, 0) == 1 ? DateTimeOffset.UtcNow : DateTimeOffset.Now;
    return JsonSerializer.Serialize(new
    {
        format,
        value = t.ToString(format),
        utc = t.Offset == TimeSpan.Zero,
        unix = t.ToUnixTimeSeconds(),
    });
}

// 3) bkn —— 纯计算/签名（与 qqkeytool 一致的 bkn/g_tk 算法）。
//    可选项：skey（必填，签名输入）。
long Bkn(dynamic p)
{
    var skey = Str((object?)p?.skey);
    long h = 5381;
    foreach (var c in skey) h += (h << 5) + c;
    return h & 0x7fffffff;
}

// 4) state —— 跨调用内存状态：每次调用 Calls+1（脚本程序集缓存，静态字段保留）。
string State(dynamic p)
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

// 5) ip —— 服务端网络请求（无 CORS）：取本机外网 IP。
string Ip(dynamic p)
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

// 6) http —— 通用 HTTP 请求。
//    可选项：
//      url        必填，目标地址
//      method     GET/POST/PUT/DELETE…（默认 GET）
//      headers    对象 { "X-A": "1", ... }（默认空；User-Agent 单独处理）
//      body       对象（自动 JSON）或字符串（原样发送）；POST/PUT/PATCH 生效
//      timeoutSec 超时秒数（默认 15，上限 120）
//    返回：{ ok, status, reason, elapsedMs, headers, body, bodyLength, truncated }
string Http(dynamic p)
{
    var url = Str((object?)p?.url);
    if (string.IsNullOrWhiteSpace(url))
        throw new ArgumentException("http: url 必填（可选项：method/headers/body/timeoutSec）");

    var method = Str((object?)p?.method, "GET").ToUpperInvariant();
    var timeoutSec = Math.Clamp(Int((object?)p?.timeoutSec, 15), 1, 120);

    using var c = MakeClient();
    c.Timeout = TimeSpan.FromSeconds(timeoutSec);
    using var req = new HttpRequestMessage(new HttpMethod(method), url);

    // 请求头可选项
    if (p?.headers is IDictionary<string, object> hdrs)
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

    // body 可选项（对象自动 JSON 序列化）
    if (p?.body is not null && method is "POST" or "PUT" or "PATCH")
    {
        object? body = p?.body;
        var text = body is string s ? s : JsonSerializer.Serialize(body);
        req.Content = new StringContent(text, Encoding.UTF8, "application/json");
    }

    var sw = System.Diagnostics.Stopwatch.StartNew();
    try
    {
        using var resp = c.Send(req);
        var body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
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
            bodyLength = body.Length,
            truncated = body.Length > 2048,
            body = body.Length > 2048 ? body[..2048] : body,
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

// 7) file —— 读取插件包内随包分发的文件（数据/配置随 zip 分发）。
//    可选项：name（默认 meta.json）。
string ReadFile(dynamic p)
{
    var name = Str((object?)p?.name, "meta.json");
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

// 8) list —— 返回数组。可选项：count（默认 5）、prefix（默认 item）。
string List(dynamic p)
{
    var count = Math.Clamp(Int((object?)p?.count, 5), 1, 100);
    var prefix = Str((object?)p?.prefix, "item");
    var items = Enumerable.Range(1, count)
        .Select(i => (object)new { index = i, label = $"{prefix}-{i}", enabled = i % 2 == 0 })
        .ToList();
    return JsonSerializer.Serialize(items);
}

// 9) table —— 返回对象数组（前端直接渲染 Table）。
//    可选项：rows（默认 3）、prefix（默认 sdk）。
string Table(dynamic p)
{
    var rows = Math.Clamp(Int((object?)p?.rows, 3), 1, 20);
    var prefix = Str((object?)p?.prefix, "sdk");
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

// 10) fail —— 抛异常：宿主统一转成 { ok:false, error }（错误契约）。
//     可选项：message（默认 "demo failure"）。
string Fail(dynamic p)
{
    throw new InvalidOperationException(Str((object?)p?.message, "demo failure"));
}

// 11) manifest —— 自描述：返回本脚本全部函数目录。
//     前端"服务端脚本"页调用它，即可实时渲染"有哪些能力、有什么可选项"。
string Manifest(dynamic p)
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

// ═══════════════ 导出（宿主要求的契约：Dictionary<string, Func<object, object>>）═══════════════

return new Dictionary<string, Func<object, object>>
{
    ["echo"]     = p => Echo((dynamic)p),
    ["now"]      = p => Now((dynamic)p),
    ["bkn"]      = p => Bkn((dynamic)p),
    ["state"]    = p => State((dynamic)p),
    ["ip"]       = p => Ip((dynamic)p),
    ["http"]     = p => Http((dynamic)p),
    ["file"]     = p => ReadFile((dynamic)p),
    ["list"]     = p => List((dynamic)p),
    ["table"]    = p => Table((dynamic)p),
    ["fail"]     = p => Fail((dynamic)p),
    ["manifest"] = p => Manifest((dynamic)p),
};
