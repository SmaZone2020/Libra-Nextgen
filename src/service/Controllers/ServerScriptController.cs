using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

/// <summary>
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
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(new { plugins = await _scripts.ListPluginScriptsJsonAsync(ct) });

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