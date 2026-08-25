using System.Collections.Concurrent;
using System.Dynamic;
using System.Reflection;
using System.Text.Json;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;

namespace LibraNextgen.Service.Services;

/// <summary>
/// 服务端 C# 脚本执行器（基于 .NET 自带 Roslyn C# Scripting）。
/// 脚本放 <c>src/service/server-scripts/&lt;name&gt;.csx</c>，编译结果按脚本名缓存，
/// 统一入口 <c>POST /api/plugin/{name}/{fn}</c> 调用（改脚本无需重编译，重新实现时自动重编）。
///
/// 脚本约定：
///   - 可直接 <c>using System.Net.Http / System.Text.Json / System.Collections.Generic</c> 等引用库，
///     自己 new HttpClient 做网络请求（服务端发起，无 CORS）。
///   - 末尾 <c>return new Dictionary&lt;string, Func&lt;object, object&gt;&gt; { ["fn"] = p => …, … };</c>
///     导出函数；<c>p</c> 为请求 body 反序列化后的 dynamic 对象（body 为空时 null）。
///   - 函数返回值作为 <c>data</c> 返回（对象自动 JSON 序列化）。
/// </summary>
public class ServerScriptService
{
    private static readonly ScriptOptions Options = ScriptOptions.Default
        .WithReferences(
            typeof(HttpClient).Assembly,
            typeof(JsonSerializer).Assembly,
            typeof(ExpandoObject).Assembly,
            typeof(Microsoft.CSharp.RuntimeBinder.RuntimeBinderException).Assembly,
            typeof(Enumerable).Assembly)
        .WithImports(
            "System", "System.Net", "System.Net.Http", "System.Text", "System.Text.Json",
            "System.Threading.Tasks", "System.Collections.Generic", "System.Dynamic", "System.Linq");

    private readonly string _scriptsDir;
    private readonly ConcurrentDictionary<string, Lazy<Script<object>>> _scripts = new();

    public ServerScriptService()
    {
        _scriptsDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "server-scripts"));
        Directory.CreateDirectory(_scriptsDir);
    }

    public string ScriptsDir => _scriptsDir;

    /// <summary>调用某脚本的某导出函数，返回其返回值（可 JSON 序列化）。</summary>
    public async Task<object?> InvokeAsync(string name, string fn, string? jsonBody, CancellationToken ct)
    {
        if (!IsSafeName(name) || !IsSafeName(fn))
            throw new ArgumentException("invalid script/function name");

        var path = Path.Combine(_scriptsDir, name + ".csx");
        if (!File.Exists(path))
            throw new FileNotFoundException($"server script '{name}.csx' not found");

        var script = _scripts.GetOrAdd(name, _ =>
            new Lazy<Script<object>>(() => CSharpScript.Create<object>(File.ReadAllText(path), Options)));

        var body = ToDynamic(jsonBody);
        var state = await script.Value.RunAsync(cancellationToken: ct).ConfigureAwait(false);

        if (state.ReturnValue is not IDictionary<string, Func<object?, object?>> funcs)
            throw new InvalidDataException($"script '{name}' must return a Dictionary<string, Func<object, object>>");

        if (!funcs.TryGetValue(fn, out var handler))
            throw new ArgumentException($"function '{fn}' not found in script '{name}'");

        return handler(body);
    }

    public static IEnumerable<string> ListScripts()
    {
        var dir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "server-scripts"));
        return Directory.Exists(dir)
            ? Directory.EnumerateFiles(dir, "*.csx").Select(p => Path.GetFileNameWithoutExtension(p) ?? "")
            : Array.Empty<string>();
    }

    private static bool IsSafeName(string s) =>
        !string.IsNullOrWhiteSpace(s)
        && s.Length <= 64
        && s.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_');

    /// <summary>把请求 JSON 转成 dynamic（ExpandoObject，递归），供脚本以 <c>p.uin</c> 方式访问。</summary>
    private static object? ToDynamic(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            return ToDynamic(doc.RootElement);
        }
        catch
        {
            return null;
        }
    }

    private static object? ToDynamic(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.Object => ObjectToExpando(e),
        JsonValueKind.Array => e.EnumerateArray().Select(ToDynamic).ToList(),
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null,
    };

    private static ExpandoObject ObjectToExpando(JsonElement e)
    {
        var exp = new ExpandoObject();
        var map = (IDictionary<string, object?>)exp;
        foreach (var prop in e.EnumerateObject())
            map[prop.Name] = ToDynamic(prop.Value);
        return exp;
    }
}