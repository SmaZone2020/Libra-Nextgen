using System.Text;
using System.Text.Json;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Middleware;

/// <summary>
/// Automatically logs all mutating API calls to the audit log.
/// Read-only endpoints (GET/HEAD/OPTIONS) are skipped.
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

        if (!isReadOnly && context.Request.Path.StartsWithSegments("/api"))
        {
            context.Request.EnableBuffering();
            var body = await ReadRequestBody(context.Request);

            var originalStream = context.Response.Body;
            using var responseBody = new MemoryStream();
            context.Response.Body = responseBody;

            try
            {
                await _next(context);
            }
            finally
            {
                context.Response.Body = originalStream;
                responseBody.Seek(0, SeekOrigin.Begin);
                var responseText = await new StreamReader(responseBody).ReadToEndAsync();
                await responseBody.CopyToAsync(originalStream);

                var userId = context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "anonymous";
                var userName = context.User.Identity?.Name ?? "anonymous";
                var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
                var success = context.Response.StatusCode < 400;

                await auditService.LogAsync(
                    userId, userName,
                    $"{method} {context.Request.Path}",
                    null,
                    body?.Length > 500 ? body[..500] : body,
                    ip, success);
            }
        }
        else
        {
            await _next(context);
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
