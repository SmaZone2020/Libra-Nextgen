using System.ComponentModel;
using System.Text.Json;
using LibraNextgen.Service.Services;
using ModelContextProtocol.Server;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// </summary>
[McpServerToolType]
public static class PluginTools
{
    [McpServerTool]
    [Description("列出所有含服务端脚本（service/main.cs）的插件及其可调用的函数名，作为 plugin_call 的目录。只读。")]
    public static async Task<string> plugin_list_functions(
        ServerScriptService scripts,
        CancellationToken ct)
    {
        try
        {
            var items = await scripts.ListPluginScriptsJsonAsync(ct);
            return McpUtils.Ok(new { plugins = items });
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
}
