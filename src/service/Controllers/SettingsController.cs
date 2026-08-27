using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Configuration;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// 后端服务设置：HTTP 监听（端口/绑定地址）与安全选项（局域网开放）。
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

    private static string SettingsFilePath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Libra-Nextgen",
            "settings.json");

    private static async Task PersistAsync(CancellationToken ct)
    {
        var dir = Path.GetDirectoryName(SettingsFilePath)!;
        Directory.CreateDirectory(dir);
        var doc = new
        {
            listener = ListenerSettingsLoader.Load(),
            security = SecuritySettingsLoader.Load(),
        };
        await System.IO.File.WriteAllTextAsync(
            SettingsFilePath,
            JsonSerializer.Serialize(doc, new JsonSerializerOptions { WriteIndented = true }),
            ct);
    }

    /// <summary>读取当前监听设置（默认 5270 / 所有网卡）。</summary>
    [HttpGet("listener")]
    public IActionResult GetListener()
    {
        var settings = ListenerSettingsLoader.Load();
        return Ok(new
        {
            host = settings.Host,
            port = settings.Port,
            bindLoopbackOnly = settings.BindLoopbackOnly,
            listenUrl = settings.ListenUrl,
        });
    }

    /// <summary>更新监听设置（端口 1..65535 / 仅本机绑定），并立即重绑 Kestrel 监听。</summary>
    [HttpPut("listener")]
    public async Task<IActionResult> SetListener([FromBody] ListenerUpdateRequest req, CancellationToken ct)
    {
        if (req.Port is not { } port || port is < 1 or > 65535)
            return BadRequest(new { error = "port must be between 1 and 65535" });

        var settings = ListenerSettingsLoader.Load();
        settings.Port = port;
        if (req.BindLoopbackOnly is { } loopback)
            settings.BindLoopbackOnly = loopback;

        try
        {
            await PersistAsync(ct);
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

        _logger.LogInformation("Listener changed to {Url}", settings.ListenUrl);
        return Ok(new
        {
            host = settings.Host,
            port = settings.Port,
            bindLoopbackOnly = settings.BindLoopbackOnly,
            listenUrl = settings.ListenUrl,
        });
    }

    /// <summary>读取当前安全设置（局域网开放等）。</summary>
    [HttpGet("security")]
    public IActionResult GetSecurity()
    {
        var settings = SecuritySettingsLoader.Load();
        return Ok(new
        {
            openLan = settings.OpenLan,
            allowedOrigins = settings.AllowedOrigins,
        });
    }

    /// <summary>更新安全设置（局域网开放开关），持久化并立即生效。</summary>
    [HttpPut("security")]
    public async Task<IActionResult> SetSecurity([FromBody] SecurityUpdateRequest req, CancellationToken ct)
    {
        var settings = SecuritySettingsLoader.Load();
        if (req.OpenLan is { } openLan)
            settings.OpenLan = openLan;
        if (req.AllowedOrigins is { } origins)
            settings.AllowedOrigins = origins;

        try
        {
            await PersistAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to persist security settings");
            return StatusCode(500, new { error = "failed to persist settings" });
        }

        _logger.LogInformation("Security settings updated: openLan={OpenLan}", settings.OpenLan);
        return Ok(new
        {
            openLan = settings.OpenLan,
            allowedOrigins = settings.AllowedOrigins,
        });
    }

    /// <summary>Kestrel 重绑委托（由 Program 注入）。</summary>
    public static Func<string, CancellationToken, Task>? RebindListeners { get; set; }
}

/// <summary>更新监听设置的请求体。</summary>
public class ListenerUpdateRequest
{
    public int? Port { get; set; }
    public bool? BindLoopbackOnly { get; set; }
}

/// <summary>更新安全设置的请求体。</summary>
public class SecurityUpdateRequest
{
    public bool? OpenLan { get; set; }
    public List<string>? AllowedOrigins { get; set; }
}
