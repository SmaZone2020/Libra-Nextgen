using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Configuration;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// 后端服务设置：当前仅支持 HTTP 监听端口（即前端访问的地址端口）。
/// 设置保存在 <c>%APPDATA%\Libra-Nextgen\settings.json</c>，修改后 Kestrel
/// 重新绑定监听（同进程立即重绑；重启后从文件恢复）。
/// </summary>
[ApiController]
[Route("api/settings")]
[Authorize]
public class SettingsController : ControllerBase
{
    private readonly ILogger<SettingsController> _logger;

    public SettingsController(ILogger<SettingsController> logger)
    {
        _logger = logger;
    }

    /// <summary>读取当前监听端口（默认 5270）。</summary>
    [HttpGet("listener")]
    public IActionResult GetListener()
    {
        var settings = ListenerSettingsLoader.Load();
        return Ok(new
        {
            host = settings.Host,
            port = settings.Port,
            listenUrl = settings.ListenUrl,
        });
    }

    /// <summary>更新监听端口（1..65535），并立即重绑 Kestrel 监听。</summary>
    [HttpPut("listener")]
    public async Task<IActionResult> SetListener([FromBody] ListenerUpdateRequest req, CancellationToken ct)
    {
        if (req.Port is not { } port || port is < 1 or > 65535)
            return BadRequest(new { error = "port must be between 1 and 65535" });

        var settings = ListenerSettingsLoader.Load();
        settings.Port = port;

        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Libra-Nextgen");
            Directory.CreateDirectory(dir);
            await System.IO.File.WriteAllTextAsync(
                Path.Combine(dir, "settings.json"),
                JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }),
                ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to persist listener settings");
            return StatusCode(500, new { error = "failed to persist settings" });
        }

        // 通知 Kestrel 重新绑定（Program 注册的重绑委托）。
        if (SettingsController.RebindListeners != null)
        {
            try
            {
                await SettingsController.RebindListeners(settings.ListenUrl, ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to rebind Kestrel to {Url}", settings.ListenUrl);
                return StatusCode(500, new { error = $"failed to rebind listener: {ex.Message}" });
            }
        }

        _logger.LogInformation("Listener port changed to {Port}", settings.Port);
        return Ok(new { host = settings.Host, port = settings.Port, listenUrl = settings.ListenUrl });
    }

    /// <summary>Kestrel 重绑委托（由 Program 注入）。</summary>
    public static Func<string, CancellationToken, Task>? RebindListeners { get; set; }
}

/// <summary>更新监听端口的请求体。</summary>
public class ListenerUpdateRequest
{
    public int? Port { get; set; }
}
