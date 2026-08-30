using System.ComponentModel;
using System.Text.Json;
using LibraNextgen.Service.Services;
using ModelContextProtocol.Server;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// 插件服务端脚本桥接工具：把插件包 <c>service/main.cs</c> 导出的函数（Roslyn C# 脚本）
/// 暴露给 Justitia（AI）。让 LLM 能调用插件的服务端能力（网络请求 / 签名 / 读包内文件 / 业务逻辑），
/// 而不仅限于 MCP 内置工具。
/// 安全说明：插件函数在 TeamServer 上执行、可发起网络请求，因此 plugin_call 挂到
/// JustitiaTier.Imperium（人工批准门槛）；plugin_list_functions 只读（Cognitio）。
/// </summary>
[McpServerToolType]
public static class PluginTools
{
    /// <summary>列出含 service/*.cs 的插件及其导出函数（plugin_call 的目录）。</summary>
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
    /// 调用插件 service/main.cs 导出的函数。插件函数在 TeamServer 上执行，可发网络请求、
    /// 读写插件包内文件——高危操作，需 Imperium 档位（人工批准）后方可执行。
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
            // 先做一次 JSON 合法性校验，避免把非法文本直接喂给脚本 dynamic。
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
