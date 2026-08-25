using System.Collections.Concurrent;
using System.Dynamic;
using System.Reflection;
using System.Text.Json;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;

namespace LibraNextgen.Service.Services;

/// <summary>
/// 服务端插件脚本驱动器（基于 .NET 自带 Roslyn C# Scripting）。
/// 插件 zip 的 <c>service/main.cs</c>（解压到 <c>PluginsBaseDir/&lt;pluginId&gt;/service/main.cs</c>）
/// 作为该插件的服务端逻辑：编译结果按插件缓存（文件变更自动失效），
/// 统一入口 <c>POST /api/plugin/{pluginId}/{fn}</c> 驱动执行。
///
/// main.cs 约定：
///   - 可直接 <c>using System.Net.Http / System.Text.Json / System.Collections.Generic</c> 等引用库，
///     自己 new HttpClient 做网络请求（服务端发起，无 CORS）。
///   - 末尾 <c>return new Dictionary&lt;string, Func&lt;object, object&gt;&gt; { ["fn"] = p => …, … };</c>
///     导出函数；<c>p</c> 为请求 body 反序列化后的 dynamic 对象（body 为空时为 null）。
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

    private sealed record CachedScript(string SourcePath, DateTime LastWriteUtc, Lazy<Script<object>> Script);

    private readonly ConcurrentDictionary<string, CachedScript> _cache = new();

    /// <summary>插件 service/main.cs 的路径（运行时解压目录优先，其次仓库内开发源）。</summary>
    public static string? SourcePathFor(string pluginId)
    {
        var runPath = Path.Combine(PluginService.PluginsBaseDir, pluginId, "service", "main.cs");
        if (File.Exists(runPath)) return runPath;
        var devPath = Path.GetFullPath(
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "plugins-service", pluginId, "main.cs"));
        return File.Exists(devPath) ? devPath : null;
    }

    /// <summary>调用某插件 service/main.cs 的某导出函数，返回其返回值（可 JSON 序列化）。</summary>
    public async Task<object?> InvokeAsync(string pluginId, string fn, string? jsonBody, CancellationToken ct)
    {
        if (!IsSafeName(pluginId) || !IsSafeName(fn))
            throw new ArgumentException("invalid plugin/function name");

        var path = SourcePathFor(pluginId)
            ?? throw new FileNotFoundException($"plugin '{pluginId}' has no service/main.cs");

        var script = EnsureScript(pluginId, path);
        var state = await script.RunAsync(cancellationToken: ct).ConfigureAwait(false);

        if (state.ReturnValue is not IDictionary<string, Func<object?, object?>> funcs)
            throw new InvalidDataException($"plugin '{pluginId}' service/main.cs must return a Dictionary<string, Func<object, object>>");

        if (!funcs.TryGetValue(fn, out var handler))
            throw new ArgumentException($"function '{fn}' not found in plugin '{pluginId}' service");

        return handler(ToDynamic(jsonBody));
    }

    /// <summary>列出已导入且含 service/main.cs 的插件及其导出函数。</summary>
    public async Task<List<(string PluginId, IReadOnlyList<string> Functions)>> ListPluginScriptsAsync(CancellationToken ct)
    {
        var result = new List<(string, IReadOnlyList<string>)>();
        if (!Directory.Exists(PluginService.PluginsBaseDir)) return result;

        foreach (var dir in Directory.EnumerateDirectories(PluginService.PluginsBaseDir))
        {
            var pluginId = Path.GetFileName(dir);
            if (!IsSafeName(pluginId)) continue;
            var main = Path.Combine(dir, "service", "main.cs");
            if (!File.Exists(main)) continue;

            try
            {
                var script = EnsureScript(pluginId, main);
                var state = await script.RunAsync(cancellationToken: ct).ConfigureAwait(false);
                var funcs = state.ReturnValue as IDictionary<string, Func<object?, object?>>;
                result.Add((pluginId, funcs?.Keys.ToList() ?? new List<string>()));
            }
            catch
            {
                // 脚本损坏不影响列表
            }
        }
        return result;
    }

    /// <summary>获取编译缓存；main.cs 文件变更（导入覆盖/时间戳变化）时重新编译。</summary>
    private Script<object> EnsureScript(string pluginId, string path)
    {
        var lastWrite = File.GetLastWriteTimeUtc(path);
        var cached = _cache.GetValueOrDefault(pluginId);
        if (cached is null || cached.LastWriteUtc != lastWrite)
        {
            var script = new CachedScript(path, lastWrite,
                new Lazy<Script<object>>(() => CSharpScript.Create<object>(File.ReadAllText(path), Options)));
            _cache[pluginId] = script;
            cached = script;
        }
        return cached.Script.Value;
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