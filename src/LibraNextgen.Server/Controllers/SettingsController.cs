using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Configuration;

namespace LibraNextgen.Service.Controllers;

/// <summary>
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

    /// <summary>
    /// Persist the CURRENT in-memory values. The historical bug: the caller
    /// modified its ListenerSettings/SecuritySettings instance but Persist
    /// re-loaded them from disk, so saves silently wrote the old values back.
    /// </summary>
    private static async Task PersistAsync(
        ListenerSettings listener, SecuritySettings security, CancellationToken ct)
    {
        var dir = Path.GetDirectoryName(SettingsFilePath)!;
        Directory.CreateDirectory(dir);
        var doc = new
        {
            listener,
            security,
        };
        await System.IO.File.WriteAllTextAsync(
            SettingsFilePath,
            JsonSerializer.Serialize(doc, new JsonSerializerOptions { WriteIndented = true }),
            ct);
    }

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
            await PersistAsync(settings, SecuritySettingsLoader.Load(), ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to persist listener settings");
            return StatusCode(500, new { error = "failed to persist settings" });
        }

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
            await PersistAsync(ListenerSettingsLoader.Load(), settings, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to persist security settings");
            return StatusCode(500, new { error = "failed to persist settings" });
        }

        // CORS policies are registered at startup: a restart is required for
        // openLan/origins to take effect (web-app mode relaunches itself;
        // the desktop shell restarts through its bridge instead).
        if (SettingsController.RebindListeners != null)
        {
            try
            {
                await SettingsController.RebindListeners(settings.OpenLan ? "lan" : "loopback", ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to schedule restart after security change");
                return StatusCode(500, new { error = $"failed to schedule restart: {ex.Message}" });
            }
        }

        _logger.LogInformation("Security settings updated: openLan={OpenLan}", settings.OpenLan);
        return Ok(new
        {
            openLan = settings.OpenLan,
            allowedOrigins = settings.AllowedOrigins,
        });
    }

    public static Func<string, CancellationToken, Task>? RebindListeners { get; set; }
}

public class ListenerUpdateRequest
{
    public int? Port { get; set; }
    public bool? BindLoopbackOnly { get; set; }
}

public class SecurityUpdateRequest
{
    public bool? OpenLan { get; set; }
    public List<string>? AllowedOrigins { get; set; }
}
