using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// 服务端插件脚本统一入口：<c>POST /api/plugin/{pluginId}/{函数名}</c>。
/// 驱动插件包内 <c>service/main.cs</c>（Roslyn C# Scripting 解析执行，可引用库做网络请求）。
/// body 任意 JSON 作为脚本函数的 <c>p</c>（dynamic）；脚本 return 值作为 <c>data</c> 返回。
/// 例子：POST /api/plugin/com.libra.qqkey/friends  {"uin":"…","clientkey":"…"}
/// </summary>
[ApiController]
[Route("api/plugin")]
[Authorize]
public class ServerScriptController : ControllerBase
{
    private readonly ServerScriptService _scripts;

    public ServerScriptController(ServerScriptService scripts)
    {
        _scripts = scripts;
    }

    /// <summary>列出含 service/main.cs 的插件及其导出函数。</summary>
    [HttpGet("list")]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(new { plugins = await _scripts.ListPluginScriptsAsync(ct) });

    [HttpPost("{pluginId}/{functionName}")]
    public async Task<IActionResult> Invoke(string pluginId, string functionName, [FromBody] JsonElement? body, CancellationToken ct)
    {
        try
        {
            var json = body.HasValue && body.Value.ValueKind != JsonValueKind.Null
                ? body.Value.GetRawText()
                : null;
            var result = await _scripts.InvokeAsync(pluginId, functionName, json, ct);
            return Ok(new { ok = true, data = result, plugin = pluginId, fn = functionName });
        }
        catch (OperationCanceledException)
        {
            return Ok(new { ok = false, error = "script execution timed out / cancelled" });
        }
        catch (Exception ex)
        {
            return Ok(new { ok = false, error = ex.InnerException?.Message ?? ex.Message });
        }
    }
}