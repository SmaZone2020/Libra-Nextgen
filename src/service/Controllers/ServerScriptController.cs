using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// 服务端 C# 脚本统一入口：<c>POST /api/plugin/{脚本名}/{函数名}</c>。
/// body 为任意 JSON（作为脚本函数的 <c>p</c>，dynamic）；脚本 return 值作为 <c>data</c> 返回。
/// 脚本放 <c>src/service/server-scripts/&lt;name&gt;.csx</c>（Roslyn C# Scripting 解析执行，可引用库做网络请求）。
/// 例子：POST /api/plugin/qqbiz/friends  {"uin":"…","clientkey":"…"}
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

    [HttpGet("list")]
    public IActionResult List() => Ok(new { scripts = ServerScriptService.ListScripts() });

    [HttpPost("{pluginName}/{functionName}")]
    public async Task<IActionResult> Invoke(string pluginName, string functionName, [FromBody] JsonElement? body, CancellationToken ct)
    {
        try
        {
            var json = body.HasValue && body.Value.ValueKind != JsonValueKind.Null
                ? body.Value.GetRawText()
                : null;
            var result = await _scripts.InvokeAsync(pluginName, functionName, json, ct);
            return Ok(new { ok = true, data = result, script = pluginName, fn = functionName });
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