using System.Security.Claims;
using System.Text;
using System.Text.Json;
using LibraNextgen.Common.Authorization;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Middleware;

/// <summary>
/// Automatically logs all mutating API calls to the audit log with a
/// behavior-based risk classification. Read-only endpoints are skipped.
/// MCP tool calls are audited the same way: the JSON-RPC body is parsed for
/// the tool name, which is mapped to a risk action key, and the access-key
/// identity is recorded — so AI-driven operations cannot bypass the
/// mandatory audit trail.
/// </summary>
public class AuditMiddleware
{
    private readonly RequestDelegate _next;

    public AuditMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, AuditService auditService)
    {
        var method = context.Request.Method;
        var isReadOnly = method is "GET" or "HEAD" or "OPTIONS";

        if (isReadOnly)
        {
            await _next(context);
            return;
        }

        if (context.Request.Path.StartsWithSegments("/mcp"))
        {
            await AuditMcpCallAsync(context, auditService);
            return;
        }

        if (!context.Request.Path.StartsWithSegments("/api"))
        {
            await _next(context);
            return;
        }

        context.Request.EnableBuffering();
        var body = await ReadRequestBody(context.Request);
        var actionKey = RiskClassifier.ClassifyAction(method, context.Request.Path, body);

        // Only agent-targeting operations are audited.
        if (actionKey == null)
        {
            await _next(context);
            return;
        }

        var originalStream = context.Response.Body;
        using var responseBody = new MemoryStream();
        context.Response.Body = responseBody;

        try
        {
            await _next(context);
        }
        finally
        {
            responseBody.Seek(0, SeekOrigin.Begin);
            var responseText = await new StreamReader(responseBody).ReadToEndAsync();
            responseBody.Seek(0, SeekOrigin.Begin);
            await responseBody.CopyToAsync(originalStream);
            context.Response.Body = originalStream;

            var userId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "anonymous";
            var userName = context.User.Identity?.Name ?? "anonymous";
            var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var success = context.Response.StatusCode < 400;

            await auditService.LogAsync(
                userId, userName,
                $"{method} {context.Request.Path}",
                actionKey,
                null,
                body?.Length > 500 ? body[..500] : body,
                ip, success);
        }
    }

    /// <summary>
    /// Audit MCP tool calls. JSON-RPC: { "method": "tools/call",
    /// "params": { "name": "delete_file", "arguments": { "agentId": "..." } } }.
    /// Non-tool methods (initialize, tools/list, notifications) are not audited.
    /// </summary>
    private async Task AuditMcpCallAsync(HttpContext context, AuditService auditService)
    {
        context.Request.EnableBuffering();
        var body = await ReadRequestBody(context.Request);

        string? toolName = null;
        string? argumentsJson = null;
        string? targetAgentId = null;

        if (!string.IsNullOrWhiteSpace(body))
        {
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Object &&
                    root.TryGetProperty("method", out var method) &&
                    method.GetString() == "tools/call" &&
                    root.TryGetProperty("params", out var p) &&
                    p.ValueKind == JsonValueKind.Object)
                {
                    toolName = p.TryGetProperty("name", out var n) ? n.GetString() : null;
                    if (p.TryGetProperty("arguments", out var a) && a.ValueKind == JsonValueKind.Object)
                    {
                        argumentsJson = a.GetRawText();
                        if (a.TryGetProperty("agentId", out var id) && id.ValueKind == JsonValueKind.String)
                            targetAgentId = id.GetString();
                    }
                }
            }
            catch (JsonException)
            {
                // Malformed JSON-RPC — pass through without audit.
            }
        }

        var actionKey = RiskClassifier.ClassifyMcpTool(toolName);
        if (actionKey == null)
        {
            await _next(context);
            return;
        }

        var originalStream = context.Response.Body;
        using var responseBody = new MemoryStream();
        context.Response.Body = responseBody;

        try
        {
            await _next(context);
        }
        finally
        {
            responseBody.Seek(0, SeekOrigin.Begin);
            var responseText = await new StreamReader(responseBody).ReadToEndAsync();
            responseBody.Seek(0, SeekOrigin.Begin);
            await responseBody.CopyToAsync(originalStream);
            context.Response.Body = originalStream;

            var userId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "anonymous";
            var userName = context.User.Identity?.Name ?? "anonymous";
            var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var success = context.Response.StatusCode < 400;

            var details = argumentsJson;
            if (details?.Length > 500) details = details[..500];

            await auditService.LogAsync(
                userId, userName,
                $"MCP {toolName}",
                actionKey,
                targetAgentId,
                details,
                ip, success);
        }
    }

    private static async Task<string?> ReadRequestBody(HttpRequest request)
    {
        request.Body.Position = 0;
        using var reader = new StreamReader(request.Body, Encoding.UTF8, leaveOpen: true);
        var body = await reader.ReadToEndAsync();
        request.Body.Position = 0;
        return string.IsNullOrWhiteSpace(body) ? null : body;
    }
}
