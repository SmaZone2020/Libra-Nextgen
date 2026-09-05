using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services.Agents;
using LibraNextgen.Service.Services.Mesh;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// Workspace mesh: hub-side management of remote Libra service nodes.
/// Every mutating operation also pushes a console event so the audit trail
/// surface (EventViewer) reflects node lifecycle changes.
/// </summary>
[ApiController]
[Route("api/mesh/nodes")]
[Authorize(Roles = "Admin")]
public class MeshNodesController : ControllerBase
{
    private readonly MeshNodeService _nodes;
    private readonly MeshSessionManager _sessions;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<MeshNodesController> _logger;

    public MeshNodesController(
        MeshNodeService nodes,
        MeshSessionManager sessions,
        IHttpClientFactory http,
        ILogger<MeshNodesController> logger)
    {
        _nodes = nodes;
        _sessions = sessions;
        _http = http;
        _logger = logger;
    }

    private string UserId => User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "";
    private string UserName => User.FindFirst(ClaimTypes.Name)?.Value ?? "";

    private object ToDto(MeshNode n)
    {
        var session = _sessions.GetSession(n.Id);
        return new
        {
            id = n.Id,
            name = n.Name,
            origin = n.Origin,
            authKind = n.AuthKind,
            username = n.AuthKind == MeshAuthKind.Password ? n.Username : null,
            createdAt = n.CreatedAt,
            updatedAt = n.UpdatedAt,
            lastConnectedAt = n.LastConnectedAt,
            lastError = n.LastError,
            connected = session != null,
            storageType = session?.StorageType,
        };
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var nodes = await _nodes.ListAsync(ct);
        return Ok(nodes.Select(ToDto));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] MeshNodeCreateReq req, CancellationToken ct)
    {
        if (req.Auth is null || req.Auth.Kind is null)
            return BadRequest(new { error = "auth.kind is required" });

        try
        {
            var node = await _nodes.CreateAsync(
                req.Name, req.Origin,
                new MeshAuthSpec(req.Auth.Kind.Value, req.Auth.Username, req.Auth.Secret ?? ""),
                UserId, UserName, ct);
            PushEvent($"节点 {node.Name} 已添加（{node.Origin}）");
            return Ok(ToDto(node));
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    [HttpPatch("{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] MeshNodePatchReq req, CancellationToken ct)
    {
        MeshAuthSpec? auth = null;
        if (req.Auth is not null)
        {
            if (req.Auth.Kind is null || req.Auth.Secret is null)
                return BadRequest(new { error = "auth.kind and auth.secret are required when updating auth" });
            auth = new MeshAuthSpec(req.Auth.Kind.Value, req.Auth.Username, req.Auth.Secret);
        }

        try
        {
            var node = await _nodes.UpdateAsync(id, new MeshNodeUpdate(req.Name, req.Origin, auth), ct);
            if (node == null) return NotFound(new { error = "mesh node not found" });

            // Origin/auth changed → any cached session is no longer valid.
            _sessions.Disconnect(id);
            PushEvent($"节点 {node.Name} 已更新");
            return Ok(ToDto(node));
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var node = await _nodes.GetAsync(id, ct);
        if (node == null) return NotFound(new { error = "mesh node not found" });

        var deleted = await _nodes.DeleteAsync(id, ct);
        if (!deleted) return NotFound(new { error = "mesh node not found" });

        _sessions.Disconnect(id);
        PushEvent($"节点 {node.Name} 已删除");
        return NoContent();
    }

    [HttpPost("{id}/connect")]
    public async Task<IActionResult> Connect(string id, CancellationToken ct)
    {
        var node = await _nodes.GetAsync(id, ct);
        if (node == null) return NotFound(new { error = "mesh node not found" });

        var result = await _sessions.ConnectAsync(node, _nodes.GetSecret(node), ct);
        await _nodes.RecordConnectResultAsync(id, result.Ok, result.Error, ct);

        if (!result.Ok)
        {
            _logger.LogWarning("Mesh connect failed for node {NodeId}: {Error}", id, result.Error);
            return BadRequest(new { error = result.Error });
        }

        PushEvent($"节点 {node.Name} 已连接（{node.Origin}）");
        return Ok(new
        {
            connected = true,
            expiresAt = result.ExpiresAt,
            storageType = result.StorageType,
        });
    }

    [HttpPost("{id}/disconnect")]
    public async Task<IActionResult> Disconnect(string id, CancellationToken ct)
    {
        var node = await _nodes.GetAsync(id, ct);
        if (node == null) return NotFound(new { error = "mesh node not found" });

        _sessions.Disconnect(id);
        PushEvent($"节点 {node.Name} 已断开");
        return Ok(new { connected = false });
    }

    /// <summary>
    /// Proxy the node's agent list through the live session. Read-only
    /// passthrough: the remote payload is forwarded untouched.
    /// </summary>
    [HttpGet("{id}/agents")]
    public async Task<IActionResult> ListAgents(string id, int page = 1, int pageSize = 100, CancellationToken ct = default)
    {
        var node = await _nodes.GetAsync(id, ct);
        if (node == null) return NotFound(new { error = "mesh node not found" });

        var session = _sessions.GetSession(id);
        if (session is null)
            return Conflict(new { error = "mesh node is not connected (connect first)" });

        if (page < 1 || pageSize is < 1 or > 200)
            return BadRequest(new { error = "page must be >= 1 and pageSize 1-200" });

        try
        {
            using var client = _http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(20);
            using var req = new HttpRequestMessage(HttpMethod.Get,
                $"{node.Origin}/api/agents?page={page}&pageSize={pageSize}");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", session.Token);

            using var resp = await client.SendAsync(req, ct);
            var text = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                return StatusCode(StatusCodes.Status502BadGateway, new { error = $"node returned HTTP {(int)resp.StatusCode}" });

            using var doc = JsonDocument.Parse(text);
            return Ok(doc.RootElement.Clone());
        }
        catch (JsonException)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "node returned a malformed response" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Mesh agent proxy failed for node {NodeId}", id);
            return StatusCode(StatusCodes.Status502BadGateway, new { error = ex.Message });
        }
    }

    // ── Generic console-API relay (cross-node operations) ──────────────────
    //
    // Console feature calls that target a remote agent (files, shell/tasks,
    // software data, proxy, tokens, per-agent system info) are transparently
    // forwarded through the node session. Management surfaces (mesh, plugins,
    // ai, auth, account, access-keys, audit, settings, events, builder...) are
    // intentionally NOT in the whitelist: plugins stay home-only by product
    // decision (v1), the rest are hub-local by nature.

    private static readonly HashSet<string> RelayAllowedFirstSegments = new(StringComparer.OrdinalIgnoreCase)
    {
        "agents", "tasks", "files", "othersoft", "proxy", "token", "system",
    };

    private static readonly HashSet<string> SystemAdminSegments = new(StringComparer.OrdinalIgnoreCase)
    {
        "storage", "listener",
    };

    private bool TryRelayPath(string relayPath, out string error)
    {
        error = "";
        if (string.IsNullOrWhiteSpace(relayPath) || relayPath.Length > 500)
        {
            error = "relay path is required (<= 500 chars)";
            return false;
        }

        var segments = relayPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0 || !RelayAllowedFirstSegments.Contains(segments[0]))
        {
            error = $"relay path '{relayPath}' is not allowed";
            return false;
        }

        if (segments.Any(s => s is ".." or "." || s.Contains('\\')))
        {
            error = "relay path contains invalid segments";
            return false;
        }

        // Per-agent system endpoints (/system/{agentId}/...) relay; hub-local
        // system administration (/system/storage, /system/listener) never does.
        if (segments[0].Equals("system", StringComparison.OrdinalIgnoreCase)
            && (segments.Length < 2 || SystemAdminSegments.Contains(segments[1])))
        {
            error = $"relay path '{relayPath}' targets hub-local system administration";
            return false;
        }

        return true;
    }

    [HttpGet("{id}/relay/{**relayPath}")]
    public Task<IActionResult> RelayGet(string id, string relayPath, CancellationToken ct)
        => RelayAsync(id, relayPath, HttpMethod.Get, ct);

    [HttpPost("{id}/relay/{**relayPath}")]
    public Task<IActionResult> RelayPost(string id, string relayPath, CancellationToken ct)
        => RelayAsync(id, relayPath, HttpMethod.Post, ct);

    [HttpPut("{id}/relay/{**relayPath}")]
    public Task<IActionResult> RelayPut(string id, string relayPath, CancellationToken ct)
        => RelayAsync(id, relayPath, HttpMethod.Put, ct);

    [HttpDelete("{id}/relay/{**relayPath}")]
    public Task<IActionResult> RelayDelete(string id, string relayPath, CancellationToken ct)
        => RelayAsync(id, relayPath, HttpMethod.Delete, ct);

    private async Task<IActionResult> RelayAsync(
        string id, string relayPath, HttpMethod method, CancellationToken ct)
    {
        if (!TryRelayPath(relayPath, out var pathError))
            return BadRequest(new { error = pathError });

        var node = await _nodes.GetAsync(id, ct);
        if (node == null) return NotFound(new { error = "mesh node not found" });

        var session = _sessions.GetSession(id);
        if (session is null)
            return Conflict(new { error = "mesh node is not connected (connect first)" });

        byte[]? body = null;
        if (method != HttpMethod.Get && (Request.ContentLength is > 0 or null))
        {
            using var ms = new MemoryStream();
            await Request.Body.CopyToAsync(ms, ct);
            if (ms.Length > 0) body = ms.ToArray();
        }

        try
        {
            var target = $"{node.Origin}/api/{relayPath}{Request.QueryString}";
            using var client = _http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(60);

            using var req = new HttpRequestMessage(method, target);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", session.Token);
            req.Headers.TryAddWithoutValidation("Accept", "application/json");
            if (body is not null && body.Length > 0)
                req.Content = new ByteArrayContent(body);
            if (body is not null)
                req.Content!.Headers.TryAddWithoutValidation("Content-Type", Request.ContentType ?? "application/json");

            using var resp = await client.SendAsync(req, ct);
            var text = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                var remoteError = ExtractJsonError(text);
                return StatusCode(StatusCodes.Status502BadGateway,
                    new { error = remoteError ?? $"node returned HTTP {(int)resp.StatusCode}" });
            }

            if (resp.StatusCode == System.Net.HttpStatusCode.NoContent)
                return NoContent();

            if (string.IsNullOrWhiteSpace(text))
                return Ok();

            return StatusCode((int)resp.StatusCode, ParseJsonOrRaw(text));
        }
        catch (OperationCanceledException)
        {
            return StatusCode(StatusCodes.Status504GatewayTimeout, new { error = "node relay timed out" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Mesh relay failed for node {NodeId} ({Method} {Path})", id, method, relayPath);
            return StatusCode(StatusCodes.Status502BadGateway, new { error = ex.Message });
        }
    }

    private static object ParseJsonOrRaw(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return text;
        }
    }

    private static string? ExtractJsonError(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.TryGetProperty("error", out var e) && e.GetString() is { Length: > 0 } msg)
                return msg.Length > 300 ? msg[..300] : msg;
        }
        catch (JsonException) { /* non-JSON error body */ }
        return null;
    }

    private void PushEvent(string text)
    {
        try
        {
            var wsManager = HttpContext.RequestServices.GetRequiredService<ConnectionManager>();
            wsManager.AppendEvent("node", text);
        }
        catch { /* best-effort */ }
    }
}

public class MeshNodeCreateReq
{
    public string Name { get; set; } = "";
    public string Origin { get; set; } = "";
    public MeshAuthReq? Auth { get; set; }
}

public class MeshNodePatchReq
{
    public string? Name { get; set; }
    public string? Origin { get; set; }
    public MeshAuthReq? Auth { get; set; }
}

public class MeshAuthReq
{
    public MeshAuthKind? Kind { get; set; }
    public string? Username { get; set; }
    public string? Secret { get; set; }
}
