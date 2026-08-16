using System.Security.Claims;
using LibraNextgen.Common.Authorization;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Middleware;

/// <summary>
/// Enforces per-user action permissions for non-Admin users. Requests whose
/// action key is not in the user's allowed set are rejected with 403.
/// </summary>
public class PermissionMiddleware
{
    private readonly RequestDelegate _next;

    public PermissionMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, PermissionService permissions)
    {
        var user = context.User;
        if (user.Identity?.IsAuthenticated == true && !user.IsInRole("Admin"))
        {
            var userId = user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            var actionKey = RiskClassifier.ClassifyAction(context.Request.Method, context.Request.Path, null);

            if (userId != null && actionKey != null && !permissions.IsAllowed(userId, actionKey))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { error = "permission denied" });
                return;
            }
        }

        await _next(context);
    }
}
