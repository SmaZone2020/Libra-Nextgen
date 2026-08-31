using System.Collections.Concurrent;
using System.Dynamic;
using System.Reflection;
using System.Text.Json;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;

namespace LibraNextgen.Service.Services;

/// <summary>
///
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

    private sealed record CachedScript(string[] SourcePaths, DateTime LastWriteUtc, Lazy<Script<object>> Script);

    private readonly ConcurrentDictionary<string, CachedScript> _cache = new();

    public static string[] SourcePathsFor(string pluginId)
    {
        var runDir = Path.Combine(PluginService.PluginsBaseDir, pluginId, "service");
        if (Directory.Exists(runDir))
        {
            var files = Directory.GetFiles(runDir, "*.cs", SearchOption.AllDirectories)
                .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (files.Length > 0) return files;
        }
        var devDir = Path.GetFullPath(
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "plugins-service", pluginId));
        if (Directory.Exists(devDir))
        {
            var files = Directory.GetFiles(devDir, "*.cs", SearchOption.AllDirectories)
                .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (files.Length > 0) return files;
        }
        return Array.Empty<string>();
    }

    public async Task<object?> InvokeAsync(string pluginId, string fn, string? jsonBody, CancellationToken ct)
    {
        if (!IsSafeName(pluginId) || !IsSafeName(fn))
            throw new ArgumentException("invalid plugin/function name");

        var paths = SourcePathsFor(pluginId);
        if (paths.Length == 0)
            throw new FileNotFoundException($"plugin '{pluginId}' has no service/*.cs");

        var script = EnsureScript(pluginId, paths);
        var state = await script.RunAsync(cancellationToken: ct).ConfigureAwait(false);

        if (state.ReturnValue is not IDictionary<string, Func<object?, object?>> funcs)
            throw new InvalidDataException($"plugin '{pluginId}' service scripts must return a Dictionary<string, Func<object, object>>");

        if (!funcs.TryGetValue(fn, out var handler))
            throw new ArgumentException($"function '{fn}' not found in plugin '{pluginId}' service");

        return handler(ToDynamic(jsonBody));
    }

    public async Task<List<(string PluginId, IReadOnlyList<string> Functions)>> ListPluginScriptsAsync(CancellationToken ct)
    {
        var result = new List<(string, IReadOnlyList<string>)>();
        if (!Directory.Exists(PluginService.PluginsBaseDir)) return result;

        foreach (var dir in Directory.EnumerateDirectories(PluginService.PluginsBaseDir))
        {
            var pluginId = Path.GetFileName(dir);
            if (!IsSafeName(pluginId)) continue;
            var paths = SourcePathsFor(pluginId);
            if (paths.Length == 0) continue;

            try
            {
                var script = EnsureScript(pluginId, paths);
                var state = await script.RunAsync(cancellationToken: ct).ConfigureAwait(false);
                var funcs = state.ReturnValue as IDictionary<string, Func<object?, object?>>;
                result.Add((pluginId, funcs?.Keys.ToList() ?? new List<string>()));
            }
            catch
            {
            }
        }
        return result;
    }

    /// <summary>
    /// </summary>
    public async Task<List<PluginScriptListEntry>> ListPluginScriptsJsonAsync(CancellationToken ct)
    {
        var items = await ListPluginScriptsAsync(ct);
        return items
            .Select(t => new PluginScriptListEntry(t.PluginId, t.Functions.ToList()))
            .ToList();
    }

    public sealed record PluginScriptListEntry(string PluginId, IReadOnlyList<string> Functions);

    private Script<object> EnsureScript(string pluginId, string[] paths)
    {
        var lastWrite = paths.Max(p => File.GetLastWriteTimeUtc(p));
        var cached = _cache.GetValueOrDefault(pluginId);
        if (cached is null
            || cached.LastWriteUtc != lastWrite
            || !cached.SourcePaths.SequenceEqual(paths))
        {
            var source = JoinScriptSources(paths);
            var script = new CachedScript(paths, lastWrite,
                new Lazy<Script<object>>(() => CSharpScript.Create<object>(source, Options)));
            _cache[pluginId] = script;
            cached = script;
        }
        return cached.Script.Value;
    }

    /// <summary>
    /// </summary>
    private static string JoinScriptSources(string[] paths)
    {
        var usings = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var bodies = new List<string>();

        foreach (var path in paths)
        {
            foreach (var line in File.ReadAllLines(path))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith("using ", StringComparison.Ordinal)
                    && trimmed.EndsWith(';')
                    && !trimmed.Contains('(')
                    && !trimmed.Contains('=')
                    && (trimmed.StartsWith("using static ", StringComparison.Ordinal)
                        || trimmed.Length > 6 /* using <ns>; */))
                {
                    if (seen.Add(trimmed)) usings.Add(line);
                }
                else
                {
                    bodies.Add(line);
                }
            }
        }

        return string.Join("\n", usings) + "\n\n" + string.Join("\n", bodies);
    }

    private static bool IsSafeName(string s) =>
        !string.IsNullOrWhiteSpace(s)
        && s.Length <= 64
        && s.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_');

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