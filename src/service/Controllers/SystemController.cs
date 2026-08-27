using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/system")]
[Authorize]
public class SystemController : ControllerBase
{
    private readonly RelayService _relay;

    public SystemController(RelayService relay)
    {
        _relay = relay;
    }

    private async Task<IActionResult> RelayAndWaitAsync(string agentId, object data, CancellationToken ct, int timeoutSeconds = 30)
    {
        // 任务化 relay：recon 模块 + op。
        var response = await _relay.RelayAndWaitAsync(agentId, "recon", data, ct,
            TimeSpan.FromSeconds(timeoutSeconds), createdBy: User.Identity?.Name ?? "system-relay");
        if (response == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });
        return Content(response, "application/json");
    }

    [HttpPost("{agentId}/processes")]
    public async Task<IActionResult> GetProcesses(string agentId, [FromBody] ProcessesRequest? req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "processes" }, ct);
    }

    [HttpPost("{agentId}/processes/kill")]
    public async Task<IActionResult> KillProcess(string agentId, [FromBody] KillProcessRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "kill", pid = req.Pid }, ct);
    }

    [HttpPost("{agentId}/windows")]
    public async Task<IActionResult> GetWindows(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "windows" }, ct);
    }

    [HttpPost("{agentId}/windows/close")]
    public async Task<IActionResult> CloseWindow(string agentId, [FromBody] WindowHwndRequest req, CancellationToken ct)
        => StatusCode(501, new { error = "not supported" });

    [HttpPost("{agentId}/windows/minimize")]
    public async Task<IActionResult> MinimizeWindow(string agentId, [FromBody] WindowHwndRequest req, CancellationToken ct)
        => StatusCode(501, new { error = "not supported" });

    [HttpPost("{agentId}/windows/maximize")]
    public async Task<IActionResult> MaximizeWindow(string agentId, [FromBody] WindowHwndRequest req, CancellationToken ct)
        => StatusCode(501, new { error = "not supported" });

    [HttpPost("{agentId}/windows/topmost")]
    public async Task<IActionResult> SetTopmost(string agentId, [FromBody] WindowHwndRequest req, CancellationToken ct)
        => StatusCode(501, new { error = "not supported" });

    [HttpPost("{agentId}/windows/bottom")]
    public async Task<IActionResult> SetBottom(string agentId, [FromBody] WindowHwndRequest req, CancellationToken ct)
        => StatusCode(501, new { error = "not supported" });

    [HttpPost("{agentId}/windows/settitle")]
    public async Task<IActionResult> SetWindowTitle(string agentId, [FromBody] WindowSetTitleRequest req, CancellationToken ct)
        => StatusCode(501, new { error = "not supported" });

    [HttpPost("{agentId}/env")]
    public async Task<IActionResult> GetEnvVars(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "env" }, ct);
    }

    [HttpPost("{agentId}/env/set")]
    public async Task<IActionResult> SetEnvVar(string agentId, [FromBody] SetEnvRequest req, CancellationToken ct)
        => StatusCode(501, new { error = "not supported" });

    [HttpPost("{agentId}/env/delete")]
    public async Task<IActionResult> DeleteEnvVar(string agentId, [FromBody] DeleteEnvRequest req, CancellationToken ct)
        => StatusCode(501, new { error = "not supported" });

    [HttpPost("{agentId}/network")]
    public async Task<IActionResult> GetNetwork(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "network" }, ct);
    }

    [HttpPost("{agentId}/network/wan")]
    public async Task<IActionResult> GetNetworkWan(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "network.wan" }, ct, timeoutSeconds: 15);
    }

    [HttpPost("{agentId}/network/wifi")]
    public async Task<IActionResult> GetNetworkWifi(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "network.wifi" }, ct, timeoutSeconds: 30);
    }

    [HttpPost("{agentId}/network/nearby")]
    public async Task<IActionResult> GetNetworkNearby(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "network.nearby" }, ct, timeoutSeconds: 30);
    }

    [HttpPost("{agentId}/network/proxy")]
    public async Task<IActionResult> GetNetworkProxy(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "network.proxy" }, ct, timeoutSeconds: 10);
    }

    [HttpPost("{agentId}/lanscan")]
    public async Task<IActionResult> LanScan(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "lanscan" }, ct);
    }

    [HttpPost("{agentId}/packages")]
    public async Task<IActionResult> Packages(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "packages" }, ct, timeoutSeconds: 60);
    }

    [HttpPost("{agentId}/docker")]
    public async Task<IActionResult> Docker(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "docker" }, ct, timeoutSeconds: 30);
    }
}

public record ProcessesRequest(string? LastHash);
public record KillProcessRequest(int Pid);
public record SetEnvRequest(string Name, string Value, string Scope);
public record DeleteEnvRequest(string Name, string Scope);
public record WindowHwndRequest(long Hwnd);
public record WindowSetTitleRequest(long Hwnd, string Title);
